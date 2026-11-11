# 登录页品牌图标破图

2026-11-10：真实未登录 GET /img/repograph-mark.svg 返回 302 到 /login，浏览器两个登录 Logo 的 naturalWidth 均为 0。
原因：安全规则放行 CSS/JS/vendor，遗漏新品牌 SVG；无鉴权的 UI preview 无法发现此错误。
修复：仅放行品牌 SVG 的匿名 GET，其他身份和管理接口规则保持不变。
回归：IdentityHttpTest 新增真实安全链资源请求断言，先观察 200 预期/302 实际失败，再修复。
完整 IdentityHttpTest 通过，bootJar 成功；重启 localhost:8080 后桌面/手机登录页所有图片 decode() 成功，登录后页头 Logo 正常。
