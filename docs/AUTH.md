---
title: Authentication Reference
description: Documentation for Authentication Reference
category: Core Features
order: 7
---
# Authentication Reference

> Complete guide to Orazaka's authentication architecture (local credentials, OAuth2, password recovery).

---

## 1. Overview

| Strategy | Module | Configuration | Description |
|:---|:---|:---|:---|
| **Local Credentials** | `orazaka-identity` | `orazaka.identity.auth.local` | Email + password hashed with BCrypt |
| **OAuth2 Exchange** | `orazaka-identity` | `orazaka.identity.auth.oauth2.*` | NextAuth verifies -> Gateway reconciles |
| **Password Reset** | `orazaka-identity` | — | Token-based reset with zero-enumeration |

> [!IMPORTANT]
> The backend **never** performs OAuth2 redirects or protocol negotiations. This is handled by NextAuth (BFF). The backend only validates tokens.

---

## 2. Local Credential Flow

```mermaid
sequenceDiagram
    participant Browser as NextAuth (Browser)
    participant BFF as Next.js BFF
    participant GW as orazaka-conversation-service
    participant IS as IdentityService
    participant IP as orazaka-persistence-identity
    participant DB as PostgreSQL

    Browser->>BFF: POST /api/auth/login {email, password}
    BFF->>GW: POST /api/v1/auth/login {email, password}
    GW->>IS: authenticate(email, password)
    IS->>IP: findByEmail...
    IP->>DB: query user details
    DB-->>IP: raw entities
    IP-->>IS: UserEntity
    IS->>IS: BCrypt.matches
    IS-->>GW: User domain record
    GW-->>BFF: JWT Token payload
    BFF-->>Browser: Set session cookie
```

- Endpoint: `POST /api/v1/auth/login`
- Payload: `{"email": "...", "password": "..."}`

---

## 3. OAuth2 Token-Exchange Flow

```mermaid
sequenceDiagram
    participant Browser as NextAuth (Browser)
    participant Provider as Google/GitHub
    participant BFF as Next.js BFF
    participant GW as orazaka-conversation-service
    participant RS as IdentityReconciliationService
    participant PV as OAuth2ProviderVerifier
    participant IP as orazaka-persistence-identity
    participant DB as PostgreSQL

    Browser->>Provider: OAuth2 Authorization Flow
    Provider-->>Browser: ID Token / Access Token
    Browser->>BFF: POST /api/auth/callback {provider, idToken}
    BFF->>GW: POST /api/v1/auth/oauth {provider, idToken}
    GW->>RS: reconcile(provider, idToken)
    RS->>PV: verifyAndExtract(idToken)
    PV-->>RS: ExtractedProfile
    RS->>IP: findByProviderAndProviderId
    IP->>DB: query user identity
    alt User exists
        DB-->>IP: UserEntity
    else New user
        RS->>IP: save(new UserEntity)
        IP->>DB: INSERT UserEntity
    end
    RS-->>GW: User domain record
    GW-->>BFF: Token response
    BFF-->>Browser: Set session cookie
```

- Endpoint: `POST /api/v1/auth/oauth`
- Payload: `{"provider": "google", "idToken": "..."}`

---

## 4. Password Recovery Flow

```mermaid
sequenceDiagram
    participant Client as Browser / CLI
    participant BFF as Next.js BFF
    participant GW as orazaka-conversation-service
    participant PRS as PasswordRecoveryService
    participant IP as orazaka-persistence-identity
    participant DB as PostgreSQL

    Note over Client,DB: Request Reset
    Client->>BFF: POST /api/auth/forgot {email}
    BFF->>GW: POST /api/v1/auth/forgot {email}
    GW->>PRS: requestPasswordReset(email)
    PRS->>IP: findByEmailAndEnabledTrue(email)
    alt User exists
        PRS->>PRS: Generate 48-byte token & hash it
        PRS->>IP: save(PasswordResetTokenEntity)
    end
    GW-->>Client: 200 OK (Always succeeds)

    Note over Client,DB: Reset Action
    Client->>BFF: POST /api/auth/reset {token, newPassword}
    BFF->>GW: POST /api/v1/auth/reset {token, newPassword}
    GW->>PRS: resetPassword(token, newPassword)
    PRS->>PRS: SHA-256 hash raw token
    PRS->>IP: findByTokenHash
    alt Token valid and active
        PRS->>PRS: BCrypt.encode (outside Tx)
        PRS->>IP: updatePasswordHash + deleteByTokenHash
        GW-->>Client: 200 OK (Success)
    else Invalid
        GW-->>Client: 400 Bad Request
    end
```

- **Forgot Password**: `POST /api/v1/auth/forgot`. Enforces **Zero-Enumeration Invariant**: returns `200 OK` regardless of whether the email exists.
- **Reset Password**: `POST /api/v1/auth/reset` with payload `{"token": "...", "newPassword": "..."}`. Returns `400` on invalid/expired token.

---

## 5. Security & Invariants

- **Token Cryptography**: 48-byte `SecureRandom` token saved as SHA-256 hash (never plaintext). Expire in 15 minutes. Single-use.
- **Password Hashing**: BCrypt is always executed outside `@Transactional` blocks to prevent pool starvation.
- **Provider Extensibility**: Implement `OAuth2ProviderVerifier` and annotate with `@ConditionalOnProperty` to support new sign-in options.
- **Database Schemas**: Password reset tokens and user password-change tracking are defined in `infra/local-db/01-schema.sql`. Flyway is disabled (`spring.flyway.enabled=false`); schemas load via Docker init scripts.
- **Concurrency**: Global security context propagation utilizes a `DelegatingSecurityContextExecutorService` wrapper bean.

---

## Related Documentation
- [Developer Onboarding Guide](101.md)
- [Architecture Reference](_generated/ARCHITECTURE.md)
- [API Reference](_generated/API_REFERENCE.md)
- [Glossary](GLOSSARY.md)

