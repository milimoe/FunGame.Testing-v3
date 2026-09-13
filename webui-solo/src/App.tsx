import SoloPanel from './components/SoloPanel'

/**
 * 单人模式独立客户端：整页只有这一个界面，没有 Tab 切换。
 *
 * 外层保留原先嵌在 webui-client 里的 `gap-1.5 p-1.5` 边距，
 * 让战场周围的留白与独立之前完全一致。
 */
export default function App() {
  return (
    <div className="flex h-full flex-col gap-1.5 p-1.5">
      <SoloPanel />
    </div>
  )
}
