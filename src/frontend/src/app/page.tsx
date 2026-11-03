import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/landing-page"

const description =
  "One space. One team. Chat, projects, approvals, forms and every business app your company runs on, in one secure workspace. Free for teams of up to 10."

export const metadata: Metadata = {
  // The root layout's template would append "· RakanSpace"; the landing page sets its own title.
  title: { absolute: "RakanSpace · One space. One team." },
  description,
  openGraph: {
    type: "website",
    siteName: "RakanSpace",
    title: "RakanSpace · One space. One team.",
    description,
  },
  twitter: { card: "summary_large_image", title: "RakanSpace · One space. One team.", description },
}

/**
 * Public landing page for everyone, rendered on the server. Signed-in people
 * see "Open workspace" in the top bar. In-app redirects use /home.
 */
export default function Home() {
  return <LandingPage />
}
