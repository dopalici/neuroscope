import type { ReactNode } from 'react'

interface Props {
  id: string
  number: string
  title: string
  children: ReactNode
}

export function Section({ id, number, title, children }: Props) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <span className="section-num">{number}</span>
        <h2>{title}</h2>
      </header>
      <div className="section-body">{children}</div>
    </section>
  )
}

interface InfoProps {
  title?: string
  children: ReactNode
  credibility: string
}

/** Newbie explanation + honesty note under each live graph. */
export function InfoBox({ title = 'What am I looking at?', children, credibility }: InfoProps) {
  return (
    <aside className="info-box">
      <h3>{title}</h3>
      <div className="info-body">{children}</div>
      <p className="credibility">
        <span className="cred-label">Credibility</span>
        {credibility}
      </p>
    </aside>
  )
}
