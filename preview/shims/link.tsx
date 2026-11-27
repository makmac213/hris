import type { AnchorHTMLAttributes } from "react";
import { toHash } from "./hash-route";

export default function Link({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={toHash(href)} {...rest} />;
}
