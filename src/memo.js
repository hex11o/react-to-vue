var babelTypes = require('@babel/types')
var getProps = require('./props')
var getFunctional = require('./functional')
const generate = require('@babel/generator').default

module.exports = function getClass (path, fileContent, result) {
  const nodeLists = path.node.body.body
  for (let i = 0; i < nodeLists.length; i++) {
    let node = nodeLists[i]
    let cPath = path.get(`body.body.${i}`)
    // get prop-types
    const nodeType = node.type
    if (nodeType === 'VariableDeclaration') {
      result.declaration.push(fileContent.slice(cPath.node.start, cPath.node.end))
    } else if (nodeType === 'ReturnStatement') {
      result.template = generate(cPath.node.argument).code
    } else if (nodeType === 'ExpressionStatement') {
      result.functional.push(fileContent.slice(cPath.node.start, cPath.node.end))
    }
  }
  return result
}
