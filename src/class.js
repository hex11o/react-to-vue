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
function parseConstructor (path, fileContent, result, root) {
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
              if (root.propTypes && root.propTypes[result.componentName] && root.propTypes[result.componentName][property.key.name]) {
                root.caveats.push(`The data property "${property.key.name}" is already declared as a prop, please redesign this component`)
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
  // path.traverse({
  //   ReturnStatement (jsxPath) {
  //     if (jsxPath.node.argument?.type === 'JSXElement') {
  //       path.traverse({
  //         JSXElement(elementPath) {
  //           elementPath.replaceWith(babelTypes.stringLiteral('// ' + generate(jsxPath.node.argument).code + ' '))
  //         }
  //       })
  //       // console.log(jsxPath.node);
  //     }
  //   }
  // })
  // replace special statement
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
  path.traverse({
    JSXElement (jsxPath) {
      let element = jsxPath.node.openingElement
      // find sub component
      if (element.name && element.name.name && /^[A-Z]/.test(element.name.name)) {
        result.components.push(element.name.name)
        let name = transformComponentName(element.name.name)
        element.name.name = name
        if (jsxPath.node.closingElement) {
          jsxPath.node.closingElement.name.name = name
        }
      }
      jsxPath.traverse({
        JSXAttribute: function JSXAttribute(attrPath) {
          var node = attrPath.node;

          if(node.value && node.value.type !== 'StringLiteral') {
            let name = node.name.name;
            switch (node.value.expression.type) {
              case 'MemberExpression':
                if (name === 'className') {
                  node.name.name = 'class';
                  var classValue = [];
                  // 获取class内部值
                  attrPath.traverse({
                    MemberExpression (expressionPath) {
                      classValue.push(expressionPath.node.property.value);
                    }
                  });
                  node.value = babelTypes.stringLiteral(classValue.join(' '));
                } else {
                  node.value = babelTypes.stringLiteral(generate(node.value.expression).code);
                  node.name.name = `:${name}`;
                }
                break;
              case 'ArrowFunctionExpression':
                node.value = babelTypes.stringLiteral(generate(node.value.expression.body).code);
                node.name.name = `@${name}`;
                break;
              case 'CallExpression':
                if (name === 'className') {
                  node.name.name = 'class';
                  var classValue = [];
                  // 获取class内部值
                  attrPath.traverse({
                    MemberExpression (expressionPath) {
                      classValue.push(expressionPath.node.property.value);
                    }
                  });
                  node.value = babelTypes.stringLiteral(classValue.join(' '));
                } else {
                  node.value = babelTypes.stringLiteral(generate(node.value.expression).code);
                  node.name.name = `:${name}`;
                }
                break;
              case 'LogicalExpression':
              case 'TemplateLiteral':
              case 'Identifier':
                node.value = babelTypes.stringLiteral(generate(node.value.expression).code);
                node.name.name = `:${name}`;
                break;
              case 'ObjectExpression':
                const style = node.value.expression.properties.map((property) => {
                  return `${property.key.name}: ${property.value.value}`
                }).join(';')
                node.value = babelTypes.stringLiteral(style);
                break;
              default:
                break;
            }
          }
          // if (node.name.name === 'ref' && node.value.type !== 'StringLiteral') {
          //   var value = node.value;
          //   var _code;
          //   // automatically increase the value
          //   var refValue = 'vueref' + refIndex++;
          //   var bodys = null;
          //   // only has one statement
          //   if ((bodys = attrPath.get('value.expression.body'), bodys) && bodys.isAssignmentExpression()) {
          //     _code = fileContent.slice(bodys.node.left.start, bodys.node.left.end);
          //     _code = "".concat(_code, " = this.$refs.").concat(refValue);
          //   } else if (bodys.node && (bodys = attrPath.get('value.expression.body.body'), bodys) && bodys.length === 1) {
          //     // only has one statement
          //     // only has one statement in the blockstatement
          //     bodys = bodys[0].get('expression.left');
          //     _code = fileContent.slice(bodys.node.start, bodys.node.end);
          //     _code = "".concat(_code, " = this.$refs.").concat(refValue);
          //   } else {
          //     _code = fileContent.slice(value.expression.start, value.expression.end);
          //     _code = "(".concat(_code, ")(this.$refs.").concat(refValue, ")");
          //   }
          //   _code += ';';
          //   var jsxContainer = attrPath.get('value');
          //   if (jsxContainer) {
          //     jsxContainer.replaceWith(babelTypes.stringLiteral(refValue));
          //   }
          //   // add the ref callback code into specified lifecycle
          //   result.lifeCycles.mounted = _code + (result.lifeCycles.mounted ? result.lifeCycles.mounted : '');
          //   result.lifeCycles.updated = _code + (result.lifeCycles.updated ? result.lifeCycles.updated : '');
          //   // result.lifeCycles.destroyed = unmountCode + (result.lifeCycles.destroyed ? result.lifeCycles.destroyed : '')
          // }
        }
      });
    },
    MemberExpression (memPath) {
      // change `this.state` and `this.props` to `this`
      let node = memPath.node
      // replace this.props.children with 'this.$slots.default'
      if (node.property.name === 'children' && node.object.object && node.object.object.type === 'ThisExpression') {
        node.property.name = 'default'
        node.object.property.name = '$slots'
      }
      if (['state', 'props'].includes(node.property.name)) {
        if (node.object.type === 'ThisExpression') {
          memPath.replaceWith(babelTypes.thisExpression())
        }
      }
    },
    VariableDeclaration(path) {
      if (path.isVariableDeclaration()) {
        result.declaration.push(fileContent.slice(path.node.start, path.node.end))
      }
    },
    JSXExpressionContainer (jsxPath) {
      const { type, left, right, operator, innerComments } = jsxPath.node.expression
      if (type === 'LogicalExpression' && left.type === 'Identifier' && right.type === 'JSXElement' && operator==='&&') {
        // 条件渲染表达式
        // exp: {a && <div>123</div>}
        const leftName = left.name
        const attribute = `v-if="${leftName}"`
        const element = jsxPath.node.expression.right
        element.openingElement.attributes.unshift(babelTypes.jsxAttribute(babelTypes.jsxIdentifier(attribute)))
        // jsxPath.node.expression.right.openingElement.
        jsxPath.replaceWith(jsxPath.node.expression.right)
      } else if (type === 'JSXEmptyExpression') {
        // 注释
        // exp: {/** 123 */}
        jsxPath.replaceWith(babelTypes.jsxText('<!-- ' +innerComments[0].value.trim() + ' -->'))
      }
    }
  })

  path.traverse({
    ReturnStatement(blockPath) {
      result.template = generate(blockPath.node.argument).code

      blockPath.traverse({
        JSXExpressionContainer (jsxPath) {
          // jsxPath.traverse({
          //   JSXEmptyExpression(jsxEmptyPath) {
          //     jsxPath.replaceWith(babelTypes.JSXText(generate(jsxEmptyPath.node).code))
          //   }
          // })
        }
      })
    }
  })

  let code = getFunctionBody(path.node.body);
  result.render = `${code}}`
}

/*
* replace static variables and methods
*/
function replaceStatic (path, root) {
  path.traverse({
    MemberExpression (memPath) {
      let propertyName = memPath.node.property.name
      let memExpression = root.source.slice(memPath.node.object.start, memPath.node.object.end)
      if (root.class.static[propertyName] && ['this.constructor', root.class.componentName].includes(memExpression)) {
        memPath.replaceWithSourceString(`static_${propertyName}`)
      }
    }
  })
}

module.exports = function getClass (path, fileContent, root) {
  Object.assign(root.class, {
    static: {},
    data: {},
    methods: [],
    lifeCycles: {},
    components: [],
    template: null,
    declaration: [],
    componentName: path.node.id.name
  })
  let result = root.class
  
  path.traverse({
    ClassMethod (path) {
      // replace statics
      replaceStatic(path, root)
      // deal with different method
      switch(path.node.key.name) {
        case 'constructor':
          parseConstructor(path, fileContent, result, root);
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
    },
    ArrowFunctionExpression(path) {
      if (!path.parent.key) return
      parseRenderMethods(path, fileContent, result)
    },
    ClassProperty (path) {
      let node = path.node
      if (node.key && ['defaultProps', 'propTypes'].includes(node.key.name)) {
        getProps(result.componentName, node.key.name, node.value, root)
      } else if (node.static) {
        if (node.value) {
          result.static[node.key.name] = root.source.slice(node.value.start, node.value.end)
        } else {
          result.static[node.key.name] = null
        }
      }
    }
  })
  return result
}
