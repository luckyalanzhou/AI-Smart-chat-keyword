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
  ["settings cards use compact spacing", () => {
    assert.match(settingsSource, /spacing=\{7\}[\s\S]*?padding=\{12\}[\s\S]*?cornerRadius: 18/)
  }],
  ["AI settings use aligned compact rows", () => {
    assert.match(settingsSource, /function InlineField\([\s\S]*?width: 64/)
    for (const label of ["服务商", "API Key", "模型"]) {
      assert.ok(settingsSource.includes(`<InlineField label="${label}">`), `missing inline field: ${label}`)
    }
  }],
  ["API key has visible secure and reveal input states", () => {
    assert.match(settingsSource, /<SecureField title="" prompt="粘贴服务商 API Key"/)
    assert.match(settingsSource, /<TextField title="" prompt="粘贴服务商 API Key"/)
    assert.match(settingsSource, /background=\{\{ style: \{ light: "#F4F6FA", dark: "#282A30"/)
    assert.match(settingsSource, /systemImage=\{showKey \? "eye" : "eye\.slash"\}/)
  }],
  ["custom endpoint is presented as an editable rounded field", () => {
    assert.match(settingsSource, /prompt="https:\/\/…\/chat\/completions"[\s\S]*?textFieldStyle="roundedBorder"/)
  }],
  ["reply suggestions are full-row insert buttons with clear affordance", () => {
    assert.match(keyboardSource, /replies\.map\(\(reply, index\) => \([\s\S]*?<Button buttonStyle="plain" action=\{\(\) => insert\(reply\)\}>[\s\S]*?background=\{mutedCardBackground\} overlay=\{roundedBorder\(12\)\}[\s\S]*?插入 ›/)
  }],
  ["generate action reflects whether suggestions already exist", () => {
    assert.match(keyboardSource, /busy \? "生成中" : hasReplyResults \? "重新生成" : "生成回复"/)
  }],
  ["keyboard height stays within the supported compact and results layouts", () => {
    assert.match(keyboardSource, /CustomKeyboard\.requestHeight\(showContext \|\| hasReplyResults \? 360 : 270\)/)
  }],
]

for (const [name, run] of checks) {
  run()
  console.log(`PASS ${name}`)
}

console.log(`\n${checks.length} UI contract checks passed.`)
