/**
 * @file main.tsx
 * @description 应用入口文件，初始化React应用并挂载到DOM
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
