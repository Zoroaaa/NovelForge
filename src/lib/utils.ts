/**
 * @file utils.ts
 * @description 工具函数文件，提供Tailwind CSS类名合并等通用工具函数
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
