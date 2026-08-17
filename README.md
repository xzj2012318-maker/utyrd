# i love s2u 💗 — 部署指南

摄像头手指文字跟随 + 手势触发声音的应用（纯前端，无后端）。

## 文件结构（整个文件夹即部署包）

```
s2u-web/
├── index.html          # 页面入口
├── app.js              # 核心逻辑（手部追踪/手势触发/声音）
├── style.css           # 样式（全屏适配手机/平板/电脑）
├── vendor/             # MediaPipe 手部识别库 + 模型（本地，无需外网）
│   ├── vision_bundle.mjs
│   ├── vision_wasm_internal.js / .wasm
│   ├── vision_wasm_nosimd_internal.js / .wasm
│   └── hand_landmarker.task
├── sounds/             # 预生成提示音（多端一致）
│   ├── i_love.wav      # "I love"
│   ├── haqiu.wav       # "哈秋"
│   ├── very.wav        # "very"
│   └── much.wav        # "much"
├── start_app.bat       # 本地一键启动（仅本机用，部署公网后不需要）
└── test_load.html      # 模型加载自测页（可删）
```

## 部署到公网（手机/电脑/iPad 均可访问）

⚠️ 摄像头权限要求 **HTTPS**（或 localhost）。免费静态托管都自带 HTTPS。

### 方式一：Netlify Drop（最简单，拖拽即部署，无需注册 git）
1. 打开 https://app.netlify.com/drop
2. 把整个 `s2u-web` 文件夹拖进页面
3. 完成！得到一个 `https://xxxx.netlify.app` 链接

### 方式二：GitHub Pages
1. GitHub 建仓库 → 上传 `s2u-web` 文件夹内容
2. Settings → Pages → Deploy from branch → 保存
3. 得到 `https://用户名.github.io/仓库名/`

### 方式三：国内托管（访问更快，需实名/备案）
- Gitee Pages、腾讯云 COS、阿里云 OSS 静态网站托管均可，把文件夹内容上传即可。

## 功能说明

| 手势 | 右手 | 左手 |
|------|------|------|
| 拇指 | i | •（点） |
| 无名指 | love | very |
| 中指 | s2u | much |
| 拇指+无名指 | "I love" | "very" |
| 拇指+中指 | "哈秋" | "much" |

## 可调参数（app.js 顶部）

| 参数 | 默认 | 说明 |
|------|------|------|
| `TOUCH_DIST` | 0.06 | 手势触发灵敏度（越大越灵敏） |
| 平滑系数 0.35/0.65 | — | 文字跟手速度（数值越小越稳、越大越跟手） |
