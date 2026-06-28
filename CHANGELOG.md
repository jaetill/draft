# Changelog

## [1.1.2](https://github.com/jaetill/draft/compare/v1.1.1...v1.1.2) (2026-06-28)


### Bug Fixes

* **.aws:** distinguish real POST errors from already-exists on branch policy ([#93](https://github.com/jaetill/draft/issues/93)) ([41e5ab9](https://github.com/jaetill/draft/commit/41e5ab979c43bd4c6d9168701482cc00f3fb2db3)), closes [#92](https://github.com/jaetill/draft/issues/92)
* **ci:** drop unused IMPLEMENTER_PAT forwarding from implementer caller (refs [#363](https://github.com/jaetill/draft/issues/363)) ([#87](https://github.com/jaetill/draft/issues/87)) ([0274189](https://github.com/jaetill/draft/commit/0274189a31e0ecf564aa20d7ab64bf614d18dec4))
* **ci:** make claude-implementer caller thin (remove drifted concurrency block) ([#484](https://github.com/jaetill/draft/issues/484)) ([#84](https://github.com/jaetill/draft/issues/84)) ([1a5b0bb](https://github.com/jaetill/draft/commit/1a5b0bb41a02ce9fb33d61b154a82f5e3fdf2e7d))
* **ci:** make env PUT body atomic — include both controls in each script ([#90](https://github.com/jaetill/draft/issues/90)) ([#91](https://github.com/jaetill/draft/issues/91)) ([2c019ea](https://github.com/jaetill/draft/commit/2c019eaeea9a08b8bac8b6a24bdd709b9edb9a2a))

## [1.1.1](https://github.com/jaetill/draft/compare/v1.1.0...v1.1.1) (2026-06-20)


### Bug Fixes

* **ci:** deduplicate concurrent cleanup-sweep dispatches (closes [#16](https://github.com/jaetill/draft/issues/16)) ([#75](https://github.com/jaetill/draft/issues/75)) ([e626082](https://github.com/jaetill/draft/commit/e6260827b93f44500da5ea6e0d0ffb07c80cf3c8))
* **ci:** document and script production env branch restriction ([#77](https://github.com/jaetill/draft/issues/77)) ([#79](https://github.com/jaetill/draft/issues/79)) ([436c497](https://github.com/jaetill/draft/commit/436c4970d3c945a829304f2da1380aa332494d9c))
* **iac:** add environment:production OIDC sub to trust-policy.json (closes [#73](https://github.com/jaetill/draft/issues/73)) ([#76](https://github.com/jaetill/draft/issues/76)) ([c6cf07f](https://github.com/jaetill/draft/commit/c6cf07f7707c042c05ea7219f558d3ed3522f5a6))

## [1.1.0](https://github.com/jaetill/draft/compare/v1.0.0...v1.1.0) (2026-06-18)


### Features

* **iac:** add ADR-0035 iac-additive-guard caller ([#280](https://github.com/jaetill/draft/issues/280)) ([#50](https://github.com/jaetill/draft/issues/50)) ([096fcfe](https://github.com/jaetill/draft/commit/096fcfe0d3c7b27ed473cacaf4c7c8f2146e7b2d))


### Bug Fixes

* **ci:** allow jaetill-ai-triage-team[bot] in release-captain allowed_bots ([#58](https://github.com/jaetill/draft/issues/58)) ([a92d57f](https://github.com/jaetill/draft/commit/a92d57f7c712ba82f33b8a56329674265d922fbd))
* **ci:** move Lambda update-function-code to gated promote job (closes [#66](https://github.com/jaetill/draft/issues/66)) ([#70](https://github.com/jaetill/draft/issues/70)) ([1f80348](https://github.com/jaetill/draft/commit/1f803481f25ccf1f5fd1fb1069176a3c188a7519))
* **ci:** scope reusable secrets explicitly (ADR-0048) ([#74](https://github.com/jaetill/draft/issues/74)) ([53f424b](https://github.com/jaetill/draft/commit/53f424b33e84e630afd5cebb2b1ebfe545ca1cbd))
* **ci:** split deploy into test+promote, publish numbered Lambda version on promote (closes [#41](https://github.com/jaetill/draft/issues/41)) ([#65](https://github.com/jaetill/draft/issues/65)) ([6fe70b5](https://github.com/jaetill/draft/commit/6fe70b50c6b891c203498bd37d392f43fe6da67b))
* **iac:** replace ReadOnlyAccess with scoped plan policy on iac-drift role ([#54](https://github.com/jaetill/draft/issues/54)) ([#61](https://github.com/jaetill/draft/issues/61)) ([88065a6](https://github.com/jaetill/draft/commit/88065a6bb685513d7dd5dff07cd65aa1342e343f))
* **iac:** scope IAMDescribe to draft-* ARNs, preventing account-wide IAM enumeration (closes [#62](https://github.com/jaetill/draft/issues/62)) ([#64](https://github.com/jaetill/draft/issues/64)) ([4420d62](https://github.com/jaetill/draft/commit/4420d62623bbf52072c53a4842cba649ac6d9954))
* **iac:** scope lambda:CreateAlias/UpdateAlias to :production ARN (closes [#40](https://github.com/jaetill/draft/issues/40)) ([#69](https://github.com/jaetill/draft/issues/69)) ([ca421e6](https://github.com/jaetill/draft/commit/ca421e6e77767513fedca36ce5909e7bbde2f231))
* **iam:** accept environment-scoped OIDC sub for gated prod deploys (ADR-0043) ([#31](https://github.com/jaetill/draft/issues/31)) ([6cccecd](https://github.com/jaetill/draft/commit/6cccecd6495e6462810734d0a4b9ef0bfd780032))
* **lambda:** correct ALLOWED_ORIGINS to draft.jaetill.com (closes [#57](https://github.com/jaetill/draft/issues/57)) ([#59](https://github.com/jaetill/draft/issues/59)) ([7e73bd8](https://github.com/jaetill/draft/commit/7e73bd80ca4501af69f8efee93222e97d3f0873b))

## 1.0.0 (2026-05-23)


### Features

* adopt Agentic Dev Environment platform (Phase 1+2) ([e9a76f8](https://github.com/jaetill/draft/commit/e9a76f867eb0719b34b7ac5f345b307962b5c56c))
* adopt Agentic Dev Environment platform (Phase 1+2) ([eb4f9d8](https://github.com/jaetill/draft/commit/eb4f9d82b7c80e1b38e1cefaea247a79f9f2f0d6))
* adopt CI workflows (Phase 4 of platform adoption) ([9237218](https://github.com/jaetill/draft/commit/9237218993de3d9da5fed3340d16d73c9445e93b))
* adopt CI workflows (Phase 4 of platform adoption) ([5145058](https://github.com/jaetill/draft/commit/5145058884616de2983ef3d0a82a86615f64c49a))
* **ci:** add agent workflows (missed in PR [#3](https://github.com/jaetill/draft/issues/3)) ([8771f26](https://github.com/jaetill/draft/commit/8771f26e6dfff97ec6cebbce60660307c5477abc))
* **ci:** add agent workflows (missed in PR [#3](https://github.com/jaetill/draft/issues/3)) ([de42a69](https://github.com/jaetill/draft/commit/de42a69f2c5dee989acfce8734ac75161b31a929))
* **ci:** migrate claude-pr-review to platform reusable (ADR-0018) ([6997455](https://github.com/jaetill/draft/commit/6997455b26d2e344eadc05a5fc1e898912f96ee9))
* **iac:** Phase 6 complete - import S3 + CloudFront + IAM ([#10](https://github.com/jaetill/draft/issues/10)) ([5399cf3](https://github.com/jaetill/draft/commit/5399cf32e5681fffefdcf81da9c69a02e9073312))
* **observability:** phase 5 - sentry browser sdk + release tagging ([#5](https://github.com/jaetill/draft/issues/5)) ([2d48ef2](https://github.com/jaetill/draft/commit/2d48ef24f4636489353c793fc8f5633636c413ea))
* **orchestration:** fleet-dispatch support + retire legacy triage-bot (ADR-0020) ([#15](https://github.com/jaetill/draft/issues/15)) ([ba14c77](https://github.com/jaetill/draft/commit/ba14c77f2575dd2b9ac801456f2525d69237553c))
* Phase 7 - user feedback widget + Lambda ([#11](https://github.com/jaetill/draft/issues/11)) ([1716fad](https://github.com/jaetill/draft/commit/1716fad99873fe321fd6566e57154a2c3d69951e))


### Bug Fixes

* **build:** correct prebuild path - .mjs not .js ([#8](https://github.com/jaetill/draft/issues/8)) ([e717aa8](https://github.com/jaetill/draft/commit/e717aa84e34e12a6fe5e6aad5c1d7cdb16f3cd74))
* **ci:** hoist NB comment out of if-block scalar (workflow was unparseable) ([#9](https://github.com/jaetill/draft/issues/9)) ([9aad4f0](https://github.com/jaetill/draft/commit/9aad4f0bd2c19496c04deae1938cb30104234eb0))
* **docs:** repair mkdocs --strict build ([#7](https://github.com/jaetill/draft/issues/7)) ([aa3d6ac](https://github.com/jaetill/draft/commit/aa3d6acd15bea7bccf9bba7d24ddb5ea25d26dac))
* **feedback:** drop bogus config.js import (draft has no config module) ([#12](https://github.com/jaetill/draft/issues/12)) ([6fca058](https://github.com/jaetill/draft/commit/6fca0584c24b62494d39f373313ea90ffa665e08))
* **iac:** add lambda:UpdateFunctionCode to draft-github-deploy role ([#13](https://github.com/jaetill/draft/issues/13)) ([eec11a3](https://github.com/jaetill/draft/commit/eec11a38dfaf6d09a90ed3404e91e7396eb184a5))
* **implementer:** allow fleet-App dispatch; drop API-key fallback ([#21](https://github.com/jaetill/draft/issues/21)) ([04b0345](https://github.com/jaetill/draft/commit/04b03450981727f9adc69841f3f66caae3fcdbcb))
