import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router/dom"
import { Toaster } from "sonner"
import { queryClient } from "./lib/queries.ts"
import { router } from "./router.tsx"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" theme="system" closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
