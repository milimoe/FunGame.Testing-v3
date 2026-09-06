import { useMemo } from 'react'

// 简易 JSON 语法高亮渲染（明亮羊皮纸版）
export default function JsonView({ value, maxHeight = '24rem' }: { value: unknown; maxHeight?: string }) {
  const text = useMemo(() => {
    if (value === undefined) return ''
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [value])

  if (!text) return <span className="text-[12px] text-ink-400">（空）</span>

  const tokens = useMemo(() => highlight(text), [text])

  return (
    <pre
      className="overflow-auto rounded-lg border border-ink-400/15 bg-parchment-50/90 p-3 font-mono text-[12px] leading-relaxed text-ink-800"
      style={{ maxHeight }}
    >
      {tokens.map((t, i) => (
        <span key={i} className={t.class}>
          {t.text}
        </span>
      ))}
    </pre>
  )
}

interface Token {
  text: string
  class: string
}

function highlight(json: string): Token[] {
  const tokens: Token[] = []
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(json)) !== null) {
    if (match.index > last) tokens.push({ text: json.slice(last, match.index), class: 'text-ink-500' })
    const token = match[0]
    let cls = 'text-sky-700'
    if (token.startsWith('"')) {
      cls = token.endsWith(':') ? 'text-gold-600' : 'text-emerald-700'
    } else if (token === 'true' || token === 'false') {
      cls = 'text-violet-700'
    } else if (token === 'null') {
      cls = 'text-ink-400'
    } else {
      cls = 'text-amber-700'
    }
    tokens.push({ text: token, class: cls })
    last = match.index + token.length
  }
  if (last < json.length) tokens.push({ text: json.slice(last), class: 'text-ink-500' })
  return tokens
}
