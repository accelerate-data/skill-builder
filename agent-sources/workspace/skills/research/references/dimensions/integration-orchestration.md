# Integration and Orchestration

## Focus

Investigate how the platform connects to version control, CI/CD systems, orchestrators, monitoring tools, and data catalogs in the customer's deployment. Look for authentication token handoffs between tools, artifact format compatibility requirements, and orchestration timing dependencies where the order and coordination of operations across tool boundaries matters.

## Delta Principle

Claude knows individual tool documentation but not how tools interact in real deployments. The integration layer (CI/CD pipelines, auth flows across tool boundaries, artifact passing) lives in team-specific runbooks, not documentation. Without this knowledge the skill generates correct isolated tool usage but misses the coordination patterns that make multi-tool workflows function.

## Coverage Targets

Research should surface: CI/CD pipeline patterns, cross-tool authentication and artifact coordination, and orchestration timing dependencies across tool boundaries. Focus on decisions that change skill content.

## Questions to Research

1. How is the platform integrated with version control and CI/CD — what pipeline stages exist and what triggers deployments?
2. Which authentication mechanisms are used at each tool boundary (service accounts, OAuth, API tokens), and how are credentials passed between tools?
3. What artifact formats must be compatible across tool boundaries (e.g., manifest files, compiled artifacts, metadata schemas)?
4. Which orchestration tool coordinates the data pipeline, and what timing dependencies exist between the platform and upstream/downstream systems?
5. Are there environment promotion workflows (dev → staging → prod) that require specific coordination steps or approval gates?
6. How are monitoring and alerting integrated — which tools receive pipeline status, and what format do they expect?
7. Are there known integration failure modes at specific tool boundaries (e.g., auth token expiry during long-running jobs, artifact format mismatches)?
