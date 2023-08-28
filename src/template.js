var babelTypes = require('@babel/types')
const { transformComponentName } = require('./utility')
const generate = require('@babel/generator').default

// 保存非常规元素
function JSXElement(jsxPath, result) {
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
}

// 处理元素属性
function JSXAttribute(attrPath) {
  var node = attrPath.node;
  if (!node.value) return
  let nodeName = node.name.name;
  // replace className to class
  if (nodeName === 'className') {
    node.name.name = 'class'
  }

  if (node.trailingComments || node.leadingComments) {
    delete node.trailingComments;
    delete node.leadingComments
  }
  if (babelTypes.isJSXIdentifier(node.name) && /^on[A-Z]/.test(node.name.name)) {
    node.name.name = `@${nodeName.slice(2).toLowerCase()}`;
  }

  nodeName = node.name.name // get new nodeName

  if(node.value.type !== 'StringLiteral') {
    switch (node.value.expression.type) {
      case 'JSXExpressionContainer':
        if (nodeName === 'class') {
          var classValue = [];
          // 获取class内部值
          attrPath.traverse({
            MemberExpression (expressionPath) {
              classValue.push(expressionPath.node.property.value);
            }
          });
          node.value = babelTypes.stringLiteral(classValue.join(' '));
        }
        break;
      case 'MemberExpression':
        if (nodeName === 'class') {
          var classValue = [];
          classValue.push(node.value.expression.property?.value);
          node.value = babelTypes.stringLiteral(classValue.join(' '));
        } else if (node.value.expression.object?.type === 'ThisExpression') {
            node.value = babelTypes.stringLiteral(generate(node.value.expression.property).code);
        } else {
          node.value = babelTypes.stringLiteral(generate(node.value.expression).code);
        }
        break;
      case 'ArrowFunctionExpression':
        const { body, params } = node.value.expression;
        if (!params.length) {
          node.value = babelTypes.stringLiteral(generate(node.value.expression.body).code);
        } else {
          node.value = babelTypes.stringLiteral(generate(node.value.expression).code);
        }
        break;
      case 'CallExpression':
        if (nodeName === 'class') {
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
          node.name.name = `:${nodeName}`;
        }
        break;
      case 'LogicalExpression':
      case 'TemplateLiteral':
      case 'BooleanLiteral':
      case 'NumericLiteral':
      case 'Identifier':
      case 'BinaryExpression':
        node.value = babelTypes.stringLiteral(generate(node.value.expression).code);
        if (babelTypes.isJSXIdentifier(node.name) && /^on[A-Z]/.test(node.name.name)) {
          // node.name.name = `@${nodeName.slice(2).toLowerCase()}`;
        } else {
          node.name.name = `:${nodeName}`;
        }
        break;
      case 'ObjectExpression':
        const style = node.value.expression.properties.map((property) => {
          return `${property.key.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}: ${property.value.value}`
        }).join('; ')
        node.value = babelTypes.stringLiteral(style);
        break;
      default:
        break;
    }
  }
}

// 处理逻辑判断
function JSXExpressionContainer(expressionPath) {
  var node = expressionPath.node;
  if (node.expression.type === 'ConditionalExpression') {
    // a ? b: c
    // expressionPath.replaceWith(node.expression);
    const { test, consequent, alternate } = node.expression;
    if (consequent.type === 'JSXElement' && alternate.type === 'NullLiteral') {
      const testCode = generate(test).code;
      const newAttribute = babelTypes.jsxAttribute(
        babelTypes.jsxIdentifier('v-if'),
        babelTypes.stringLiteral(testCode)
      );
      consequent.openingElement.attributes.unshift(newAttribute);
    }
    const expression = expressionPath.get('expression');
    expression.replaceWith(consequent);
  } else if (node.expression.type === 'LogicalExpression') {
    // a && <div></div>
    let { left, right, operator } = node.expression;
    if (operator === '||' && right.type === 'NullLiteral' && left.type === 'LogicalExpression') {
      // a && <div></div> || null
      expressionPath.replaceWith(left); 
      right = left.right;
      operator = left.operator;
      left = left.left;
    }
    if (operator === '&&' && right.type === 'JSXElement') {
      const leftCode = generate(left).code;
      const newAttribute = babelTypes.jsxAttribute(
        babelTypes.jsxIdentifier('v-if'),
        babelTypes.stringLiteral(leftCode)
      );

      right.openingElement.attributes.unshift(newAttribute);
      expressionPath.replaceWith(right);
    }
    // bb || sds
  }
}

module.exports = function (path, fileContent, result) {
  path.traverse({
    JSXElement: (jsxPath) => JSXElement(jsxPath, result),
    JSXAttribute,
    JSXExpressionContainer
  })
}
