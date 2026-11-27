import { fromHash, toHash, useHash } from "./hash-route";

export function usePathname() {
  return fromHash(useHash()).path;
}

export function useSearchParams() {
  return new URLSearchParams(fromHash(useHash()).query);
}

export function useRouter() {
  return {
    push: (href: string) => {
      window.location.hash = toHash(href);
      window.scrollTo(0, 0);
    },
  };
}

export function redirect(href: string): never {
  window.location.hash = toHash(href);
  throw new Error("redirect");
}
