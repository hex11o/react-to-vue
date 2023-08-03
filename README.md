# react-to-vue
transform a basic react component to vue component

## Install
npm install slb-rtv -g

## Usage

``` sh
Usage: rtv [options] file(react component)

Options:

  -V, --version         output the version number
  -o --output [string]  the output file name
  -t --ts               it is a typescript component
  -f --flow             it is a component with Flow type annotations
  -h, --help            output usage information

```

## 项目说明
本项目是一个命令行工具，通过babel编译，babel的逻辑很简单，通过讲代码编译为ast, 然后提供工具类对ast代码重新处理，转换为我们的目标代码；

- [astexploer.net](https://astexplorer.net/): 一个在线的ast编译工具，可以看到ast的结构，以及对应的代码

## react拆分说明
- import：归属到vue组件的script部分
`import React from 'react'`
- declaration：归属到vue组件的script部分
`const a = 11`
- class：拆分归属到vue组件的template与script部分
`class A extends React.Component {}`
- memo: 正在兼容处理拆分

## 代码解释说明

## 使用说明

## 项目进度
- [√] import
- [√] declaration
- [√] class: 模块拆分，className处理，click事件处理
- [-] memo
- [] class render条件渲染
- [] class render循环渲染
- [] class render组件替换

