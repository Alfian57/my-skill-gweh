# quality

Keep modules focused; separate complex UI logic, colocate feature code, and reuse existing abstractions.

## Responsibility boundaries

Changes should follow established repository patterns. Inspect sibling files, available abstractions, and related tests before choosing a new structure.

- Give each module one primary reason to change. Separate parsing, domain rules, data access, and presentation when their boundaries genuinely differ.

- Do not add a layer, service, base class, or architecture folder just to move a few lines of code.

- Refactor only what the active change requires; note unrelated findings without expanding the task scope.


## Readability and size

- Use intention-revealing names and specific types. Avoid obscure local abbreviations, hidden sentinel values, and comments that merely repeat the code.

- UI components above roughly 250 lines are a review signal, not a mechanical limit. Extract parts that have independent responsibilities and behavior.

- Prefer abstractions already used by the repository; a new generalization needs multiple real use cases or a clear domain boundary.


## Correctness and failures

- Validate input at system boundaries before using it in domain logic or persistence. Do not treat compile-time types as runtime data validation.

- Handle failures explicitly: preserve error context, return an appropriate response, and do not swallow exceptions without a reason.

- Do not log credentials, tokens, sensitive payloads, or personal data that is not needed for diagnosis.


## Apply to the detected stack

- For PHP/Laravel, follow the existing `app/`, `routes/`, and `database/` structure and sibling patterns. Prefer Laravel facilities over new abstraction frameworks.


## Review checklist

- [ ] The change follows the nearest established pattern or explains why it differs.
- [ ] New modules do not add abstractions without a verified need.
- [ ] Errors, runtime input, and sensitive data are handled explicitly.

[Project context map](project-context.md) · [Workflow](workflow.md)
