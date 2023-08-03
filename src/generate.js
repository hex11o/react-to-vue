var format = require("prettier-eslint");
var {transformComponentName} = require('./utility')

function mergeExportComponent (object) {
  let com = null;
  object.functional.forEach((func, index) => {
    if (func.functional) {
      com = func
      // remove functional component
      object.functional.splice(index, 1)
    }
  })
  if (!com) {
    com = object.class
  }
  return com
}

module.exports = function generateVueComponent (object) {

  let content = ''

  // merge export component
  let component = mergeExportComponent(object)
  
  // generate export component
  if (component && component.render) {
    // add template
    if (component.template) {
      content += '<template>\n' + component.template + '\n</template>\n\n'
    }

    // add script start
    content += `<script setup name="${component.componentName}" lang="ts">\n`

    // add imports
    object.import.forEach((item) => {
      content += item + '\n'
    })

    // add common function
    object.functional.forEach((func) => {
      // common function
      content += func + '\n\n'
    })

    // add props
    if (object.propTypes && object.propTypes[component.componentName]) {
      let props = object.propTypes[component.componentName]
      let defaultValues = object.defaultProps && object.defaultProps[component.componentName]
      let propArr = []
      for (let item in props) {
        let value = props[item]
        if (defaultValues && defaultValues[item]) {
          value.default = defaultValues[item]
        }
        let arr = []
        for (let key in value) {
          if (key === 'type') {
            arr.push(`${key}: ${value[key]}`)
          } else if (key === 'required') {
            arr.push(`${key}: ${value[key]}`)
          } else {
            arr.push(`${key}: ${ value.type === 'String' ? `'${value[key]}'` : value[key] }`)
          }
        }
        propArr.push(`${item}: {${arr.join(',\n')}}`)
      }
      vueProps.push(`const props = defineProps({${propArr.join(',\n')}})`)
    }

    // add data
    if (component.data && Object.keys(component.data).length) {
      let data = component.data
      let arr = []
      for (let key in data) {
        arr.push(`${key}: ${data[key]}`)
      }
      let value = arr.join(',\n')
      content += `const state = reactive({${value}})\n\n`
    }

    // add life cycles
    if (component.lifeCycles && Object.keys(component.lifeCycles).length) {
      for (let key in component.lifeCycles) {
        content += `${key}(() => {${component.lifeCycles[key]}})\n\n`
      }
    }

    // add variable declaration
    object.declaration.forEach((item) => {
      content += item + '\n'
    })

    // add class declaration
    component.declaration.forEach((item) => {
      content += item + '\n\n'
    })

    // add class static variables and methods if exists
    if (component.static) {
      for (let name in component.static) {
        if (component.static[name]) {
          content += `let static_${name} = ${component.static[name]}\n`
        } else {
          content += `let static_${name}\n`
        }
      }
    }

    // add methods
    if (component.methods && component.methods.length) {
      content += component.methods.join('\n\n')
    }

    // add script end
    content += '\n</script>\n\n'
  }

  // add style
  content += `<style lang="less" scoped>\n@import "./index.less"; \n</style>\n\n`
  
  // format content
  // const options = {
  //   text: content,
  //   eslintConfig: {
  //     parser: 'babel-eslint',
  //     rules: {
  //       semi: ["error", "never"],
  //       quotes: ["error", "single"],
  //       "no-extra-semi": 2,
  //       "max-len": ["error", { "code": 150 }],
  //       "object-curly-spacing": ["error", "never"],
  //       "space-before-function-paren": ["error", "always"],
  //       "no-multiple-empty-lines": ["error", { "max": 0}],
  //       "line-comment-position": ["error", { "position": "beside" }]
  //     }
  //   }
  // };
  // content = format(options);
  return content
}
