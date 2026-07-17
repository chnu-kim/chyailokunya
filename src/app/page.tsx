import { greet } from "@/core/greeting";
import { ThemeToggle } from "./theme-toggle";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <p className="font-script text-accent-ink text-2xl">chyailokunya · Phase 1</p>
      <h1 className="font-display text-5xl leading-tight text-balance">{greet("쿠냐")}</h1>
      <p className="text-fg-muted text-lg">
        Next.js · Cloudflare Workers · OpenNext 스캐폴딩이 살아 있다냐.
      </p>
      <ThemeToggle />
    </main>
  );
}
