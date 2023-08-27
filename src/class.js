var babelTypes = require('@babel/types')
var getProps = require('./props')
var getFunctional = require('./functional')
const generate = require('@babel/generator').default
const {getFunctionBody, transformSourceString, transformComponentName} = require('./utility')
// autumatically increate index 
var refIndex = 0

/*
* transform setState function
*/
function transformSetstate (node, fileContent) {
  let statement = []
  let args = node.expression.arguments
  let str = ''
  if (args[0]) {
    str = fileContent.slice(args[0].start, args[0].end)
    if (args[0].type === 'ObjectExpression') {
      args[0].properties.map(function (property) {
        statement.push(`this.${property.key.name} = ${fileContent.slice(property.value.start, property.value.end)}`)
      })
    } else {
      str = '(' + str + ')(this, this)'
      statement.push(`Object.assign(this, ${str})`)
    }
  }
  // there exits callback
  if (args[1]) {
    let callback = fileContent.slice(args[1].start, args[1].end)
    statement.push(`this.$nextTick(${callback})`)
  }
  // transform source string to nodes
  statement = transformSourceString(statement)
  return statement
}

/*
* replace setState,ref and etc
*/
function replaceSpecialStatement (path, fileContent) {
  path.traverse({
    ExpressionStatement(expressPath) {
      let node = expressPath.node;
      if (!node.start) {
        return;
      }
      let sectionCon = fileContent.slice(node.start, node.end);
      let statement = "";
      if (/^this\.setState/.test(sectionCon)) {
        // transform setState
        statement = transformSetstate(node, fileContent);
      }
      if (statement.length) {
        expressPath.replaceWithMultiple(statement);
      }
    },
    MemberExpression (memPath) {
      let node = memPath.node
      if (node.property.name === 'refs') {
        if (node.object.type === 'ThisExpression') {
          node.property.name = '$refs'
        }
      }
      // replace `this.state.xx` with `this.xx`
      if (['state', 'props'].includes(node.property.name)) {
        if (node.object.type === 'ThisExpression') {
          memPath.replaceWith(babelTypes.thisExpression())
        }
      }
    },
    JSXAttribute (attrPath) {
      let node = attrPath.node
      if (node.name.name === 'className') {
        node.name.name = 'class'
      } else if (node.name.name === 'dangerouslySetInnerHTML') {
        node.name.name = 'domPropsInnerHTML'
        let expression = attrPath.get('value.expression')
        if (expression.isIdentifier()) {
          expression.replaceWithSourceString(`${expression.node.name}.__html`)
        } else {
          expression.replaceWith(expression.get('properties.0.value'))
        }
      }
    }
  });  
}

// parse constructor
function parseConstructor (path, fileContent, result) {
  let paramName = path.get('params.0') ? path.get('params.0').node.name : null
  path.traverse({
    ExpressionStatement (expressPath) {
      let node = expressPath.node
      let sectionCon = fileContent.slice(node.start, node.end)
      if (/^super|\.bind\(this\)/.test(sectionCon)) {
        expressPath.remove()
        return
      }
      // retrieve variables
      if (/^this\.state/.test(sectionCon)) {
        expressPath.traverse({
          ObjectExpression (objPath) {
            let properties = objPath.node.properties
            for (let i = 0; i < properties.length; i++) {
              let property = properties[i]
              let value = fileContent.slice(property.value.start, property.value.end)
              // validate if it exists in the props
              if (result.propTypes && result.propTypes[result.componentName] && result.propTypes[result.componentName][property.key.name]) {
                result.caveats.push(`The data property "${property.key.name}" is already declared as a prop, please redesign this component`)
              } else {
                result.data[property.key.name] = value.replace(/this\.props/g, 'this').replace(/props/g, 'this')
              }
            }
          }
        })
        expressPath.remove()
      }
    },
    MemberExpression (memPath) {
      // replace this.props.xx or props.xx
      let node = memPath.node
      if (babelTypes.isThisExpression(node.object) && ['state', 'props'].includes(node.property.name)) {
        memPath.replaceWith(babelTypes.thisExpression())
      } else if (paramName && node.object.name === paramName) {
        node.object.name = 'this'
      }
    }
  })
  // put this code into `created` lifecycle
  let code = getFunctionBody(path.node.body)
  if (code.trim()) {
    result.lifeCycles['onBeforeMount'] = code
  }
}

// parse life cycle methods
function parseLifeCycle (path, method, fileContent, result) {
  // replace special statement
  replaceSpecialStatement(path, fileContent)
  // debugger
  let code = getFunctionBody(path.node.body)
  result.lifeCycles[method] = code
}

// parse events
function parseMethods (path, fileContent, result) {
  // replace special statement
  replaceSpecialStatement(path, fileContent)
  // generate method
  let code = getFunctionBody(path.node.body);
  let method = path.node.key.name
  let params = path.node.params
  let paramsArr = []
  for (let i = 0; i < params.length; i++) {
    paramsArr.push(fileContent.slice(params[i].start, params[i].end))
  }
  code = `function ${method} (${paramsArr.join(', ')}) {${code}}`
  result.methods.push(code)
}

function parseRenderMethods (path, fileContent, result) {
  replaceSpecialStatement(path, fileContent)
  // generate method
  let code = getFunctionBody(path.node.body);
  let method = path.parent.key.name
  let params = path.node.params
  let paramsArr = []
  for (let i = 0; i < params.length; i++) {
    paramsArr.push(fileContent.slice(params[i].start, params[i].end))
  }
  code = `function ${method} (${paramsArr.join(', ')}) {${code}}`
  result.methods.push(code)
}

// parse render
function parseRender (path, fileContent, result) {
  // retrieve special properties
  let nodeLists = path.node.body.body
  for (let i = 0; i < nodeLists.length; i++) {
    let node = nodeLists[i]
    let cPath = path.get(`body.body.${i}`)
    const nodeType = node.type
    switch(nodeType) {
      case 'VariableDeclaration':
        result.declaration.push(fileContent.slice(cPath.node.start, cPath.node.end))
        break;
      case 'ReturnStatement':
        result.template = generate(cPath.node.argument).code
        break;
    }
  }
}

/*
* replace static variables and methods
*/
function replaceStatic (path, result) {
  path.traverse({
    MemberExpression (memPath) {
      let propertyName = memPath.node.property.name
      let memExpression = result.source.slice(memPath.node.object.start, memPath.node.object.end)
      if (result.class.static[propertyName] && ['this.constructor', result.class.componentName].includes(memExpression)) {
        memPath.replaceWithSourceString(`static_${propertyName}`)
      }
    }
  })
}

module.exports = function getClass (classPath, fileContent, result) {
  let nodeLists = classPath.node.body.body
  result.componentName = classPath.node.id.name
  for (let i = 0; i < nodeLists.length; i++) {
    let node = nodeLists[i]
    let path = classPath.get(`body.body.${i}`)
    const nodeType = node.type
    if (nodeType === 'ClassMethod') {
      // replace statics
      // replaceStatic(path, result)
      // deal with different method
      switch(node.key.name) {
        case 'constructor':
          parseConstructor(path, fileContent, result);
          break;
        case 'componentWillMount':
          parseLifeCycle(path, 'onBeforeMount', fileContent, result);
          break;
        case 'componentDidMount':
          parseLifeCycle(path, 'onMounted', fileContent, result);
          break;
        case 'componentWillUpdate':
          parseLifeCycle(path, 'onBeforeUpdate', fileContent, result);
          break;
        case 'componentDidUpdate':
          parseLifeCycle(path, 'onUpdated', fileContent, result);
          break;
        case 'componentWillUnmount':
          parseLifeCycle(path, 'onBeforeUnmount', fileContent, result);
          break;
        case 'componentDidCatch':
          parseLifeCycle(path, 'onErrorCaptured', fileContent, result);
          break;
        case 'shouldComponentUpdate':
        case 'componentWillReceiveProps':
          break;
        case 'render':
          parseRender(path, fileContent, result);
          break;
        default:
          parseMethods(path, fileContent, result);
          break;
      }
    } else if (nodeType === 'ClassProperty') {
      const functionNode = path.get('value')
      parseRenderMethods(functionNode, fileContent, result)
    }
  }
}
