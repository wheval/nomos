"use client";

import type { MouseEvent } from "react";
import type { useRouter } from "next/navigation";
import styles from "../../../uni.module.css";

type Router = ReturnType<typeof useRouter>;

// Make a whole row open a record, for table rows and the div-based rows on
// Overview alike.
//
// The row click is a mouse convenience only — each row still carries a real
// <Link> to the same destination, which is what keyboard and screen-reader
// users follow. Putting role="link"/tabIndex on the row instead would
// announce it as a link and, inside a table, break the grid semantics.
//
// Clicks landing on a nested control (the explorer link, Copy) are left
// alone: closest() catches them here rather than making every nested element
// remember to stop propagation.
export function rowNavProps(router: Router, href: string, extraClassName?: string) {
  return {
    className: extraClassName ? `${extraClassName} ${styles.rowLink}` : styles.rowLink,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest("a, button, input, select, label")) return;
      router.push(href);
    },
  };
}
