#!/usr/bin/env node
const DAY = 86400;

export function lifecycleRules() {
  return {
    rules: [
      {
        id: "expire-uploads",
        enabled: true,
        conditions: { prefix: "uploads/" },
        deleteObjectsTransition: { condition: { type: "Age", maxAge: 7 * DAY } },
      },
    ],
  };
}
