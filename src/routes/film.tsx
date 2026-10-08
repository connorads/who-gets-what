import { createFileRoute, redirect } from '@tanstack/react-router'
import { parseFilmSearch } from '#/film/search.ts'

/** The film is the home page; old links keep their parameters, and the browser keeps the chapter hash. */
export const Route = createFileRoute('/film')({
  validateSearch: parseFilmSearch,
  beforeLoad: ({ search }) => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router reads thrown redirects as control flow
    throw redirect({ to: '/', search, statusCode: 301 })
  },
})
