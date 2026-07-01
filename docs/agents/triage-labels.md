# Triage Labels

ForgeFlow skills 用六个规范 triage roles 表达状态。此文件将这些 roles 映射到本仓库 issue tracker 实际使用的 label 字符串。

| ForgeFlow 规范 role | 本仓库 label      | 含义                                         |
| ------------------- | ----------------- | -------------------------------------------- |
| `needs-triage`      | `needs-triage`    | 新进入，待维护者评估并路由                   |
| `needs-info`        | `needs-info`      | 阻塞：等待报告者补充，补齐后回流 needs-triage |
| `ready-for-agent`   | `ready-for-agent` | 已明确，Agent 可无人工干预直接领取           |
| `ready-for-human`   | `ready-for-human` | 需要人工判断，Agent 不应处理                 |
| `wontfix`           | `wontfix`         | 终态：主动拒绝，不会处理                     |
| `resolved`          | `resolved`        | 终态：正常处理完毕                           |

## 状态流转

```
新 issue
   needs-triage
         needs-info (补齐后) needs-triage
         ready-for-agent (处理完) resolved
         ready-for-human (处理完) resolved
         wontfix
```

## 使用说明

- 修改右侧列以匹配你实际使用的 label 字符串。
- 当 skill 提到某个 role（例如"应用 ready-for-agent triage label"）时，使用此表右侧列对应的字符串。
- `needs-info` 信息补齐后必须回流至 `needs-triage`，不可直接跳转至 `ready-for-*`。
- Agent 只处理 `ready-for-agent` 状态的 issue，`ready-for-human` 不得由 Agent 领取。
