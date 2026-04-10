import { describe, expect, it } from "vitest";
import {
	DEFAULT_MODEL_TIERS,
	type ModelTiers,
	resolveModelForTier,
	routeModel,
} from "./model-router.js";

describe("routeModel", () => {
	// --- Task type → tier mapping ---

	it("routes research tasks to fast tier in explore mode", () => {
		const result = routeModel(
			"Research the best approaches for vector search",
			"explore",
		);
		expect(result.tier).toBe("fast");
		expect(result.taskType).toBe("research");
		expect(result.model).toBe(DEFAULT_MODEL_TIERS.fast);
	});

	it("routes writing tasks to fast tier in explore mode", () => {
		const result = routeModel(
			"Draft an email to the engineering team about the release",
			"explore",
		);
		expect(result.tier).toBe("fast");
		expect(result.taskType).toBe("writing");
	});

	it("routes coding tasks to balanced tier in explore mode", () => {
		const result = routeModel(
			"Implement a user authentication module with JWT",
			"explore",
		);
		expect(result.tier).toBe("balanced");
		expect(result.taskType).toBe("coding");
		expect(result.model).toBe(DEFAULT_MODEL_TIERS.balanced);
	});

	it("routes planning tasks to capable tier in explore mode", () => {
		const result = routeModel(
			"Plan out the database migration in phases with milestones",
			"explore",
		);
		expect(result.tier).toBe("capable");
		expect(result.taskType).toBe("planning");
		expect(result.model).toBe(DEFAULT_MODEL_TIERS.capable);
	});

	it("routes debugging tasks to balanced tier in explore mode", () => {
		const result = routeModel(
			"Debug why the login page throws a 500 error in production",
			"explore",
		);
		expect(result.tier).toBe("balanced");
		expect(result.taskType).toBe("debugging");
	});

	it("routes unclassifiable tasks to balanced tier", () => {
		const result = routeModel(
			"hello how are you doing today friend",
			"explore",
		);
		expect(result.tier).toBe("balanced");
		expect(result.taskType).toBe("general");
	});

	// --- Execute mode bump ---

	it("bumps tier by one for execute mode", () => {
		// Research: fast → balanced in execute
		const result = routeModel(
			"Research the best approaches for vector search",
			"execute",
		);
		expect(result.tier).toBe("balanced");
		expect(result.reason).toContain("execute+1");
	});

	it("caps execute bump at capable tier", () => {
		// Planning: capable → still capable (capped)
		const result = routeModel(
			"Plan out the database migration in phases with milestones",
			"execute",
		);
		expect(result.tier).toBe("capable");
	});

	it("bumps coding from balanced to capable in execute mode", () => {
		const result = routeModel(
			"Implement a user authentication module with JWT",
			"execute",
		);
		expect(result.tier).toBe("capable");
	});

	// --- Complexity signals ---

	it("upgrades tier for architecture tasks", () => {
		// Coding: balanced + architecture → capable
		const result = routeModel(
			"Implement the new microservice architecture for the payment system",
			"explore",
		);
		expect(result.tier).toBe("capable");
	});

	it("upgrades tier for multi-file tasks", () => {
		const result = routeModel(
			"Refactor the multi-file validation module across all services",
			"explore",
		);
		expect(result.tier).toBe("capable");
	});

	it("upgrades tier for security review tasks", () => {
		const result = routeModel(
			"Implement a security review for the auth endpoints",
			"explore",
		);
		expect(result.tier).toBe("capable");
	});

	// --- Simplicity signals ---

	it("downgrades tier for simple lookup tasks", () => {
		// Coding normally → balanced, but "find the" → fast
		const result = routeModel(
			"Find the configuration file for the database settings module",
			"explore",
		);
		expect(result.tier).toBe("fast");
	});

	it("downgrades tier for explanation tasks", () => {
		const result = routeModel(
			"Explain how the authentication middleware processes requests",
			"explore",
		);
		expect(result.tier).toBe("fast");
	});

	it("downgrades tier for summarize tasks", () => {
		const result = routeModel(
			"Summarize the recent changes in the codebase and their impact",
			"explore",
		);
		expect(result.tier).toBe("fast");
	});

	// --- Combined signals ---

	it("simplicity + execute cancel out for research", () => {
		// Research=fast, simplicity=-1→fast(clamped), execute=+1→fast
		// Actually: fast(0) + simplicity(-1)=fast(clamped 0) + execute(+1)=balanced(1)
		const result = routeModel(
			"Look up what the latest React version supports for server components",
			"execute",
		);
		expect(result.tier).toBe("balanced");
	});

	it("complexity + execute can reach capable from fast", () => {
		// Research=fast(0), architecture=+1→balanced(1), execute=+1→capable(2)
		const result = routeModel(
			"Research distributed system architecture patterns for our platform",
			"execute",
		);
		expect(result.tier).toBe("capable");
	});

	// --- Custom tiers ---

	it("uses custom tier models when provided", () => {
		const custom: ModelTiers = { fast: "my-fast-model" };
		const result = routeModel(
			"Research the best approaches for vector search",
			"explore",
			custom,
		);
		expect(result.model).toBe("my-fast-model");
	});

	it("falls back to default tiers for unset custom tiers", () => {
		const custom: ModelTiers = { fast: "my-fast-model" };
		const result = routeModel(
			"Implement a user authentication module with JWT",
			"explore",
			custom,
		);
		expect(result.model).toBe(DEFAULT_MODEL_TIERS.balanced);
	});

	it("uses fallback model when tier model is empty", () => {
		const custom: ModelTiers = { fast: "" };
		const result = routeModel(
			"Research the best approaches for vector search",
			"explore",
			custom,
			"my-fallback",
		);
		expect(result.model).toBe("my-fallback");
	});

	// --- Reason string ---

	it("includes task type in reason", () => {
		const result = routeModel(
			"Research the best approaches for vector search",
			"explore",
		);
		expect(result.reason).toContain("type=research");
	});

	it("includes execute marker in reason", () => {
		const result = routeModel(
			"Implement something interesting for the team",
			"execute",
		);
		expect(result.reason).toContain("execute+1");
	});

	it("includes final tier in reason", () => {
		const result = routeModel(
			"Plan out the database migration in phases",
			"explore",
		);
		expect(result.reason).toContain("→capable");
	});

	// --- Backend routing ---

	it("routes to agent-sdk for execute+coding at capable tier", () => {
		// coding=balanced(1), architecture=+1→capable(2), execute=+1→capable(clamped)
		const result = routeModel(
			"Refactor the entire authentication architecture with JWT",
			"execute",
		);
		expect(result.tier).toBe("capable");
		expect(result.backend).toBe("agent-sdk");
		expect(result.reason).toContain("sdk");
	});

	it("routes to thin for explore mode even at capable tier", () => {
		const result = routeModel(
			"Plan out the database migration in phases",
			"explore",
		);
		expect(result.tier).toBe("capable");
		expect(result.backend).toBe("thin");
	});

	it("routes to thin for execute+coding at balanced tier (simplicity offsets execute)", () => {
		// coding=balanced(1), "look up"=-1→fast(0), execute=+1→balanced(1) → thin
		const result = routeModel(
			"Look up the config format and implement the missing field",
			"execute",
		);
		expect(result.tier).toBe("balanced");
		expect(result.backend).toBe("thin");
	});

	it("routes to thin for execute+research tasks", () => {
		const result = routeModel(
			"Research distributed system architecture patterns",
			"execute",
		);
		// research=fast(0), architecture=+1→balanced(1), execute=+1→capable(2)
		// But research is not SDK-eligible
		expect(result.backend).toBe("thin");
	});

	it("routes to agent-sdk for execute+debugging at capable tier", () => {
		// debugging=balanced(1), multi-service=+1→capable(2), execute=+1→capable(clamped)
		const result = routeModel(
			"Debug the multi-service integration failure in the auth pipeline",
			"execute",
		);
		expect(result.tier).toBe("capable");
		expect(result.backend).toBe("agent-sdk");
	});

	it("routes to agent-sdk for execute+automation at capable tier", () => {
		// automation=balanced(1), cross-cutting=+1→capable(2), execute=+1→capable(clamped)
		const result = routeModel(
			"Automate the cross-cutting deployment pipeline for all services",
			"execute",
		);
		expect(result.tier).toBe("capable");
		expect(result.backend).toBe("agent-sdk");
	});

	// --- Research mode ---

	it("research mode does not get execute bump", () => {
		// Research task type → fast, no execute bump → stays fast
		const result = routeModel(
			"Research the best approaches for vector search",
			"research",
		);
		expect(result.tier).toBe("fast");
		expect(result.reason).not.toContain("execute+1");
	});

	it("research mode routes to thin backend", () => {
		const result = routeModel(
			"Research distributed system architecture patterns",
			"research",
		);
		expect(result.backend).toBe("thin");
	});

	it("research mode still applies complexity signals", () => {
		// research=fast(0), architecture=+1→balanced(1)
		const result = routeModel(
			"Research system architecture patterns for distributed consensus",
			"research",
		);
		expect(result.tier).toBe("balanced");
	});
});

describe("resolveModelForTier", () => {
	it("resolves fast tier to default haiku", () => {
		expect(resolveModelForTier("fast")).toBe(DEFAULT_MODEL_TIERS.fast);
	});

	it("resolves balanced tier to default sonnet", () => {
		expect(resolveModelForTier("balanced")).toBe(DEFAULT_MODEL_TIERS.balanced);
	});

	it("resolves capable tier to default opus", () => {
		expect(resolveModelForTier("capable")).toBe(DEFAULT_MODEL_TIERS.capable);
	});

	it("uses custom tier models", () => {
		expect(resolveModelForTier("fast", { fast: "custom-fast" })).toBe(
			"custom-fast",
		);
	});

	it("falls back to fallback model for empty tier", () => {
		expect(resolveModelForTier("fast", { fast: "" }, "fallback")).toBe(
			"fallback",
		);
	});

	it("falls back to balanced default when all else fails", () => {
		expect(resolveModelForTier("fast", { fast: "" })).toBe(
			DEFAULT_MODEL_TIERS.balanced,
		);
	});
});
