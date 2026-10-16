# Content policy — you decide

Orazaka is open source and does not censor. It ships a **policy engine that the operator configures**, not a
built-in filter. A fresh, self-hosted install is **permissive**: nothing is refused because of what a prompt is
about. What the engine gives you is a way to say, in your own database, what *your* installation refuses or
routes — and to protect *your* provider accounts from terms you have agreed to.

## What it does

For every Studio run, **before** credits are held, a run row is written or any provider is reached, Orazaka:

1. **Classifies the prompt locally** (rules, in the service's own JVM — the prompt is never sent anywhere to be
   classified). Labels: `SEXUAL_EXPLICIT`, `SEXUAL_SUGGESTIVE`, `MINORS_RISK`, `VIOLENCE_GRAPHIC`,
   `REAL_PERSON_LIKENESS`, `NONE`.
2. **Applies your configuration** (tenant settings, then provider terms — below).
3. **Writes the decision to an append-only audit table** (`content_policy_audit`): the labels, the decision
   (`ALLOWED`, `WARNED`, `REFUSED`) and the rule that decided. **Never the prompt.**

A refusal answers `422` with the stable code `content.policy_refused`, the rule and the labels. Clients translate
the code; the server does not send prose.

## The one rule you cannot change

**`MINORS_RISK` is always refused**, for every tenant, on every provider, whatever the settings say. Sexual
content involving a minor is illegal everywhere; this is not a moral filter and not a setting. Nothing in the
database turns it off.

## What you configure (all in the Studio database)

| Table | What it says | Default (no rows) |
|---|---|---|
| `content_policy_tenant` | For a `subject` (`'*'` = the whole install, or one actor id) and a label: `ALLOW` or `REFUSE`. | Everything allowed |
| `content_provider_policy` | What a provider's **terms** allow: `allows_adult_content`, `allows_graphic_violence`, `allows_real_person_likeness`, and `enforcement` = `BLOCK` or `WARN`. Keyed by the capability's feature key (e.g. `orazaka.core.media.video`). | No restriction |
| `content_policy_rule` | Extra classifier patterns (a label and a regex over lower-cased, accent-folded text). | Built-in rules only |

### Protecting your provider account

Hosted inference providers publish acceptable-use terms. If yours forbids a kind of content, mark the capability
that reaches it:

```sql
INSERT INTO content_provider_policy (provider_key, allows_adult_content, enforcement, note)
VALUES ('orazaka.core.media.video', FALSE, 'BLOCK', 'Hosted provider terms: no adult content');
```

A run whose prompt carries `SEXUAL_EXPLICIT` or `SEXUAL_SUGGESTIVE` is then refused (`BLOCK`) or logged and let
through (`WARN`) **before the provider is called**. This exists to protect the operator's own account, not to
judge the user. Point the same prompt at a capability served by your own hardware — which you have not
restricted — and it runs.

### Refusing something on your install

```sql
-- refuse explicit sexual content for everyone on this install
INSERT INTO content_policy_tenant (subject, label, action) VALUES ('*', 'SEXUAL_EXPLICIT', 'REFUSE');
-- allow it again for one actor (a row for the actor overrides the '*' row)
INSERT INTO content_policy_tenant (subject, label, action) VALUES ('actor-id', 'SEXUAL_EXPLICIT', 'ALLOW');
```

## Checking without generating: the dry run

`POST /api/v1/studios/{studioKey}/policy-check` with the same body as a run answers what the policy would do —
labels, decision, rule, warnings, the capabilities involved — **without holding credits, writing a run or calling
any provider**. Use it to test your configuration.

## What it does not do (yet)

- It classifies the **input**. A classifier on the generated frames (output side) is tracked as a follow-up.
- Rules are the local floor; a local-model classifier can sit behind the same contract.
- Direct image jobs that do not go through a Studio are not covered by the Studio gate yet (follow-up).
- Provider terms are marked per capability; per-model marking is a follow-up.

## Our hosted dev instance

`dev.orazaka.com` runs with DigitalOcean's terms respected: the video capability, served by DigitalOcean
serverless inference, is marked `allows_adult_content = FALSE` (`BLOCK`). That is configuration
(`infra/deploy/dev-content-policy.sql`, applied by `node scripts/dev-deploy.mjs policy`), not code — your install
has no such row unless you add it.
