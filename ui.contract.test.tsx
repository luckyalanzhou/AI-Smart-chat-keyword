// Source-level UI regression checks for this Scripting project.
// Run from the project root with:
// node -e "require.extensions['.tsx'] = require.extensions['.js']; require('./ui.contract.test.tsx')"
// This file intentionally uses JavaScript syntax only so Node can execute it
// without adding a build tool to the iOS Scripting project.

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const settingsSource = fs.readFileSync(path.join(__dirname, "index.tsx"), "utf8")
const keyboardSource = fs.readFileSync(path.join(__dirname, "keyboard.tsx"), "utf8")

const checks = [
  ["settings use Scripting's grouped native form", () => {
    assert.match(settingsSource, /import \{[^}]*\bForm\b[^}]*\bSection\b[^}]*\} from "scripting"/)
    assert.match(settingsSource, /<Form\s+formStyle="grouped"/)
    assert.equal((settingsSource.match(/<Section\b/g) || []).length, 3)
    assert.doesNotMatch(settingsSource, /SettingsCard|glassEffect|glassBorder|<ScrollView/)
  }],
  ["profile and provider choices use native menu pickers", () => {
    assert.equal((settingsSource.match(/<Picker\b[^>]*pickerStyle="menu"/g) || []).length, 6)
    for (const title of ["性别", "当前状态", "性格", "表达风格", "服务商", "模型"]) {
      assert.ok(settingsSource.includes(`title="${title}" pickerStyle="menu"`), `missing native menu picker: ${title}`)
    }
  }],
  ["API key has an accessible label and native secure/reveal states", () => {
    assert.match(settingsSource, /<SecureField title="API Key" prompt="粘贴服务商 API Key"/)
    assert.match(settingsSource, /<TextField title="API Key" prompt="粘贴服务商 API Key"/)
    assert.match(settingsSource, /systemImage=\{showKey \? "eye" : "eye\.slash"\}/)
    assert.match(settingsSource, /title=\{showKey \? "隐藏" : "显示"\}/)
  }],
  ["advanced endpoint remains progressively disclosed and editable", () => {
    assert.match(settingsSource, /title=\{showAdvanced \? "收起接口设置" : "自定义接口地址"\}/)
    assert.match(settingsSource, /showAdvanced \? <TextField title="接口地址" prompt="https:\/\/…\/chat\/completions"/)
  }],
  ["keyboard uses adaptive system surface and native rounded inputs", () => {
    assert.match(keyboardSource, /const keyboardBackground = "secondarySystemBackground"/)
    assert.equal((keyboardSource.match(/textFieldStyle="roundedBorder"/g) || []).length, 2)
    assert.match(keyboardSource, /<Picker label=\{<Text modifiers=\{modifiers\(\)\.font\(12\)\.foregroundStyle\("tint"\)\}>\{profile\.tone\}⌄<\/Text>\} pickerStyle="menu"/)
    assert.doesNotMatch(keyboardSource, /<RoundedRectangle|roundedBorder\(|cardBackground|mutedCardBackground|inputBackground/)
  }],
  ["reply suggestions remain directly tappable native buttons", () => {
    assert.match(keyboardSource, /<Button buttonStyle="bordered" buttonBorderShape=\{\{ roundedRectangleRadius: 12 \}\} action=\{\(\) => insert\(reply\)\}>/)
    assert.match(keyboardSource, /插入/)
    assert.match(keyboardSource, /buttonStyle="borderedProminent" tint="blue"/)
  }],
  ["generation, context, sender selection, and completion actions remain available", () => {
    for (const feature of ["生成回复", "添加上下文", "完成", "清空", "对方："]) {
      assert.ok(keyboardSource.includes(feature), `missing keyboard action: ${feature}`)
    }
    assert.match(keyboardSource, /busy \? "生成中" : hasReplyResults \? "重新生成" : "生成回复"/)
    assert.match(keyboardSource, /CustomKeyboard\.insertText\(text\)/)
  }],
  ["keyboard height stays within Scripting's recommended range", () => {
    assert.match(keyboardSource, /CustomKeyboard\.requestHeight\(showContext \|\| hasReplyResults \? 360 : 270\)/)
    assert.match(keyboardSource, /CustomKeyboard\.requestHeight\(270\)/)
  }],
]

for (const [name, run] of checks) {
  run()
  console.log(`PASS ${name}`)
}

console.log(`\n${checks.length} UI contract checks passed.`)
