var fs = require('fs')
var getProps = require('./props')
var getClass = require('./class')
var getMemo = require('./memo')
var saveComponent = require('./save')
var generateVueComponent = require('./generate')
var transformElement = require('./template')
var getFunctional = require('./functional')
var babelTraverse = require('@babel/traverse').default
var babelParser = require('@babel/parser')
var chalk = require('chalk')
var transformTS = require('./ts')

var {reportIssue, removeBadCode, isVariableFunc} = require('./utility')

module.exports = function transform (src, options) {
  // read file
  let fileContent = fs.readFileSync(src)
  fileContent = fileContent.toString()
  // hard code
  fileContent = removeBadCode(fileContent)

  // traverse module
let result = {
  // vue template
  "template": "", 
  // vue script
  "componentName": "", // 组件名
  "components": [], // 未找到名称的组件
  "import": [],
  "declaration": [],
  "functional": [],
  "data": {},
  "lifeCycles": {},
  "methods": [],

  "propTypes": {},
  "defaultProps": {},
  // there exists incompatibility
  "caveats": [],
  "source": fileContent
}

  // parse module
  let ast = babelParser.parse(fileContent, {
    sourceType:'module',
    plugins: ["typescript", "classProperties", "jsx", "trailingFunctionCommas", "asyncFunctions", "exponentiationOperator", "asyncGenerators", "objectRestSpread", "decorators"]
  })
  if (options.ts) {
    transformTS(ast)
  }
  // fix trailingComments issues with hard code 
  babelTraverse(ast, {
    BlockStatement (path) {
      path.node.body.forEach((item) => {
        if (item.trailingComments && fileContent.charCodeAt([item.end]) === 10) {
          delete item.trailingComments
        }
      })
    },
    JSXElement (path) {
      transformElement(path, fileContent, result)
    }
  })

  babelTraverse(ast, {
    Program (path) {
      let nodeLists = path.node.body
      let classDefineCount = 0
      for (let i = 0; i < nodeLists.length; i++) {
        let node = nodeLists[i]
        let cPath = path.get(`body.${i}`)
        // get prop-types
        if (cPath.isExpressionStatement() && node.expression.type === 'AssignmentExpression') {
          let leftNode = node.expression.left
          if (leftNode.type === 'MemberExpression' && ["defaultProps", "propTypes"].includes(leftNode.property.name)) {
            let className = node.expression.left.object.name
            getProps(className, leftNode.property.name, node.expression.right, result)
          }
        } else if (cPath.isClassDeclaration()) {
          classDefineCount ++
          if (classDefineCount > 1) {
            console.error('One file should have only one class declaration!')
            process.exit()
          }
          getClass(cPath, fileContent, result)
        } else if (cPath.isExportDefaultDeclaration()) {
          result.exportName = node.declaration.name ? node.declaration.name : 'index' // 导出的组件名
        } else if (cPath.isImportDeclaration()) {
          if (!["react", "prop-types", "react-dom", 'dva/router', 'dva', 'antd', 'classnames', './index.less', 'uuid'].includes(node.source.value)) {
            result.import.push(fileContent.slice(node.start, node.end))
          }
        } else if (cPath.isVariableDeclaration()) {
          const { init, id } = node.declarations[0]
          if (init.type === 'CallExpression' && init.callee.name === 'memo') {
            result.componentName = id.name
            const memoContent = cPath.get(`declarations.0.init.arguments.0`)
            getMemo(memoContent, fileContent, result)
          } else {
            result.declaration.push(fileContent.slice(node.start, node.end))
          }
        } else if (cPath.isFunctionDeclaration()) {
          getFunctional(cPath, fileContent, result)
        } else if (cPath.isArrowFunctionExpression()) {
          getFunctional(cPath, fileContent, result, 'arrow')
        }
      }
    }
  })

  // check props validation
  // if (!Object.keys(result.propTypes).length && /props/.test(fileContent)) {
  //   result.caveats.push(`There is no props validation, please check it manually`)
  // }
  delete result.source
  // console.log(result)
  // generate vue component according to object
  let output = generateVueComponent(result)
  
  // save file
  saveComponent(options.output, output)
  
  // output caveats
  // if (result.caveats.length) {
  //   console.log(chalk.red("Caveats:"));
  //   console.log(chalk.red(result.caveats.join('\n')))
  // }
}
