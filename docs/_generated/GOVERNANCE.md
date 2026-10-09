---
title: Governance Rules
description: The architecture rules enforced at build time, and the suites that enforce each one, extracted from orazaka-test-support.
category: Architecture
order: 8
generated: true
---

# Governance Rules

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.


A rule with **no suite** is a rule that enforces nothing — it is written, it compiles, and no
build fails when it is violated. Treat an empty cell as a defect, not as a gap.


## ConfigBindingRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertConfigurationBindsUnambiguously` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`GovernanceTest`<br/>`IdentityServiceGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Asserts [CFG-001] over the given classes: no type reachable from a configuration-binding root has more than one constructor without one of them annotated @ConstructorBinding. |
| `assertInjectableComponentsHaveOneConstructor` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`GovernanceTest`<br/>`IdentityServiceGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Asserts every Spring-instantiated component has a constructor set the container can choose from. |

## ExecutorCoherenceRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertEveryCapabilityHasAnExecutor` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | [EXEC-001] Every enabled capability executed <b>in process</b> has a JobExecutor for its handler_key. |
| `assertEveryCapabilityIsDrained` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | [EXEC-002] Every enabled capability's routing_key is drained by some worker's declared bindings. |

## GovernanceRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertCollectionFieldsPrivateFinal` | `BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts collection fields (List, Map, Set) in non-record classes are private final. |
| `assertDedupIsAtomic` | `JobServiceGovernanceTest` | [KIT-002] Message deduplication has one author: krizaka-messaging. |
| `assertDomainHasNoTransportDtos` | `BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`StudioServiceGovernanceTest` | Asserts the domain package holds no transport DTOs (*Request/*Response). |
| `assertDomainPurity` | `IdentityGovernanceTest`<br/>`ToolsGovernanceTest` | [HEX-002] Prohibits domain classes from depending on framework packs. |
| `assertEndpointRuleHasOneAuthor` | `JobServiceGovernanceTest` | [CAP-002] The endpoint rule has one author. |
| `assertEveryCapabilityHasAnExecutor` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | [EXEC-001] Fails when an in-process capability's handler_key has no JobExecutor. |
| `assertEveryCapabilityIsDrained` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | [EXEC-002] Fails when a capability's routing_key is drained by no declared worker. |
| `assertFieldsPrivate` | `BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts instance fields in concrete non-record classes are private. |
| `assertImplClassesPackagePrivate` | `PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest` | Asserts *Impl classes in the given service package are not public. |
| `assertInternalSurfaceRequiresServiceAuthority` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Fails when a SecurityConfig matches /internal/v1/** without demanding the SERVICE authority. |
| `assertMappersFinal` | `IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`PersistenceBridgeGovernanceTest` | Asserts *Mapper classes in the given package are final. |
| `assertMappersPackagePrivate` | `IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`PersistenceBridgeGovernanceTest` | Asserts *Mapper classes in the given package are not public. |
| `assertNoAnonymousClasses` | `BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts no anonymous classes in production (with enum/TypeReference exemption). |
| `assertNoDependencyOn` | `BusinessBoundaryTest`<br/>`InterceptorsBoundaryTest` | Asserts that classes in modulePackage do not depend on forbiddenPackage. |
| `assertNoFieldInjection` | `BillingServiceGovernanceTest`<br/>`BusinessBoundaryTest`<br/>`InterceptorsBoundaryTest`<br/>`JobServiceGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`StudioServiceGovernanceTest` | Asserts no @Autowired field injection in the given module package. |
| `assertNoForeignTier3Dependency` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`StudioServiceGovernanceTest` | [SEAM-002] Asserts an autonomous service depends on no bounded context's Tier-3 (owned-domain) implementation. |
| `assertNoPackKeyConditionals` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | [PACK-003] Fails when engine code branches on one of those identifiers — inline, or through a constant declared in the same file. |
| `assertNoPackKeyLiterals` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | [PACK-002] Fails when a pack, studio, or pack-capability key appears as a literal in engine code under orazaka-libs/**, orazaka-apps/services/** or orazaka-apps/workers/**. |
| `assertNoPermitAllOnInternalOrUploads` | `BillingServiceGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Fails when a SecurityConfig opens /internal/** or /uploads/**. |
| `assertNoRedundantPrefix` | `BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`StudioServiceGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts no class names start with 'Orazaka' prefix. |
| `assertNoStandardStreams` | `BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`StudioServiceGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts no classes access System.out or System.err. |
| `assertNoWebControllers` | `BusinessGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts no @RestController or @Controller annotations exist in the given module. |
| `assertOneCapabilityModel` | `JobServiceGovernanceTest` | [CAP-001] One record models a capability, and the projections of it say so. |
| `assertOneDeclarationAuthor` | `StudioServiceGovernanceTest` | [SAGA-002] One author resolves what a dispatched step carries from its pack. |
| `assertOneSettlementAuthor` | `StudioServiceGovernanceTest` | [SAGA-001] One author closes a run's credit hold. |
| `assertOneTopLevelClassPerFile` | `BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`StudioServiceGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts every top-level class resides in a dedicated file matching its simple name. |
| `assertOutboxRelaysClaim` | `JobServiceGovernanceTest` | [KIT-003] An outbox store claims the rows the relay publishes, and the relay has one author. |
| `assertPersistenceAdapterPackageKind` | `IdentityGovernanceTest` | Asserts the exact infrastructure.adapter.persistence package (excluding its entity/repository/converter sub-packs) holds only *Adapter/*Mapper — one package, one component kind [ERR-130]. |
| `assertPersistencePackageHygiene` | `PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest` | Asserts JPA components reside in correct sub-packs. |
| `assertSagaReadersDoNotWrite` | `StudioServiceGovernanceTest` | [SAGA-003] The saga's read-only invariants stay read-only. |
| `assertSecurityBaselineIsUniform` | `JobServiceGovernanceTest` | [KIT-001] Every service's filter chain starts from the one security baseline. |
| `assertServicePackageOnlyServices` | `BillingServiceGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`StudioServiceGovernanceTest`<br/>`ToolsGovernanceTest` | Asserts every top-level class in servicePackage is named *Service (capability-oriented). |
| `assertSessionSecurityHasOneAuthor` | `JobServiceGovernanceTest` | [KIT-004] Session-token security has one author: krizaka-security. |
| `assertStrictHexagonalBoundaries` | `ToolsGovernanceTest` | [HEX-001] Enforces strict hexagonal layer dependencies using ArchUnit's layeredArchitecture. |
| `assertSupportPackageHygiene` | **none** | Asserts infrastructure.support holds only cross-cutting helpers / shared plumbing — never a use-case *Service, a *Controller/*Adapter, or config [ERR-130]. |
| `assertVirtualThreadsEnabled` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Fails when a service that serves HTTP does not run its requests on virtual threads. |

## GovernanceSubjects

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertEveryRuleIsNonVacuous` | `GovernanceSubjectsTest` | [GOV-006] Asserts every governance rule in this package is non-vacuous by construction. |

## LaneCoherenceRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertEveryCapabilityDeclaresItsLane` | `JobServiceGovernanceTest` | [LANE-001] Every seeded capability whose routing key a lane binds declares that lane's class. |

## LoggedContentRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertNoLoggingCallTakesContent` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`GovernanceTest`<br/>`IdentityServiceGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Asserts [LOG-001] over the given classes: no argument of a logging call is, or was derived from, a prompt, a response body or a message text. |

## MeteringMarkerRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertEveryJobProducerDeclaresItsMetering` | `MeteringMarkerTest` | Asserts that every class publishing to the jobs exchange stamps #MARKER or is exempt with a written reason. |

## PackCoherenceRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertPackCatalogueIsCoherent` | `SqlBoundaryTest` | Asserts the pack catalogue is coherent: infra/initdb seeds no pack, and no bundle manifest declares a pack the database would refuse. |

## RunSurfaceRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertNoInboundEntryDispatchesAJob` | `BillingServiceGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`IdentityGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest` | Asserts [DOOR-001] over this module's production classes, against the whole repository's sinks. |

## SourceFileScanner

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertNoBannedLiterals` | `EdgeGovernanceTest` | Scans Java source files under sourceRoot for default banned patterns [GOV-003]. |
| `assertNoEnvironmentInjection` | `AutomationServiceGovernanceTest`<br/>`BillingServiceGovernanceTest`<br/>`BusinessGovernanceTest`<br/>`EdgeGovernanceTest`<br/>`GovernanceTest`<br/>`IdentityGovernanceTest`<br/>`IdentityServiceGovernanceTest`<br/>`InterceptorsGovernanceTest`<br/>`JobServiceGovernanceTest`<br/>`KnowledgeServiceGovernanceTest`<br/>`NotificationServiceGovernanceTest`<br/>`PersistenceBridgeGovernanceTest`<br/>`PersistenceGovernanceTest`<br/>`PersistenceIdentityGovernanceTest`<br/>`RouterGovernanceTest`<br/>`StudioServiceGovernanceTest`<br/>`ToolsGovernanceTest` | Scans for org.springframework.core.env.Environment imports in non-@Configuration classes [ERR-113]. |

## SqlBoundaryRules

| Rule | Enforced by | Summary |
|:---|:---|:---|
| `assertNoCrossContextForeignKeys` | `SqlBoundaryTest` | Asserts that every REFERENCES in every *.sql file under initdbDir targets a table created in the same file (same bounded context). |
