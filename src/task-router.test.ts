import { describe, expect, it } from "vitest";
import { formatTaskHint, routeTask } from "./task-router.js";

describe("routeTask", () => {
	it("returns null for very short messages", () => {
		expect(routeTask("hi")).toBeNull();
		expect(routeTask("fix it")).toBeNull();
	});

	it("returns null for unclassifiable messages", () => {
		expect(routeTask("hello, how are you today?")).toBeNull();
	});

	// --- Research ---
	it("detects research tasks", () => {
		expect(
			routeTask("Research the best approaches for vector search in TypeScript"),
		)?.toHaveProperty("type", "research");
		expect(
			routeTask("Compare the top 5 JavaScript testing frameworks"),
		)?.toHaveProperty("type", "research");
		expect(
			routeTask("What are the best practices for API rate limiting?"),
		)?.toHaveProperty("type", "research");
	});

	it("recommends web and management groups for research", () => {
		const route = routeTask("Investigate how other teams handle authentication");
		expect(route?.groups).toContain("web");
		expect(route?.groups).toContain("management");
	});

	// --- Coding ---
	it("detects coding tasks", () => {
		expect(
			routeTask("Implement a user authentication module with JWT"),
		)?.toHaveProperty("type", "coding");
		expect(
			routeTask("Refactor the payment processing code to use async/await"),
		)?.toHaveProperty("type", "coding");
		expect(
			routeTask("Write unit tests for the validation utility functions"),
		)?.toHaveProperty("type", "coding");
	});

	it("recommends code and advanced_editing groups for coding", () => {
		const route = routeTask("Implement a new feature for the dashboard component");
		expect(route?.groups).toContain("code");
		expect(route?.groups).toContain("advanced_editing");
	});

	// --- Data Analysis ---
	it("detects data analysis tasks", () => {
		expect(
			routeTask("Analyze the data in sales.csv and find trends"),
		)?.toHaveProperty("type", "data_analysis");
		expect(
			routeTask("Create a histogram of response times from the dataset"),
		)?.toHaveProperty("type", "data_analysis");
		expect(
			routeTask("Find correlations between user engagement and revenue metrics"),
		)?.toHaveProperty("type", "data_analysis");
	});

	it("recommends code group for data analysis", () => {
		const route = routeTask("Analyze the dataset and create visualizations");
		expect(route?.groups).toContain("code");
	});

	// --- Writing ---
	it("detects writing tasks", () => {
		expect(
			routeTask("Write a blog post about microservices architecture"),
		)?.toHaveProperty("type", "writing");
		expect(
			routeTask("Draft an email to the engineering team about the migration"),
		)?.toHaveProperty("type", "writing");
		expect(
			routeTask("Proofread my proposal and suggest improvements"),
		)?.toHaveProperty("type", "writing");
	});

	it("recommends no extra groups for writing", () => {
		const route = routeTask("Draft a proposal for the new API design");
		expect(route?.groups).toEqual([]);
	});

	// --- Planning ---
	it("detects planning tasks", () => {
		expect(
			routeTask("Create a project plan for the Q3 migration initiative"),
		)?.toHaveProperty("type", "planning");
		expect(
			routeTask("Design the architecture for the notification system"),
		)?.toHaveProperty("type", "planning");
		expect(
			routeTask("Help me prioritize these features for the next sprint"),
		)?.toHaveProperty("type", "planning");
	});

	it("recommends management group for planning", () => {
		const route = routeTask("Plan out the database migration in phases with milestones");
		expect(route?.groups).toContain("management");
	});

	// --- Debugging ---
	it("detects debugging tasks", () => {
		expect(
			routeTask("Debug why the login page throws a 500 error"),
		)?.toHaveProperty("type", "debugging");
		expect(
			routeTask("There's a race condition in the worker pool, help me fix it"),
		)?.toHaveProperty("type", "debugging");
		expect(
			routeTask("The tests are failing with a stack trace pointing to auth.ts"),
		)?.toHaveProperty("type", "debugging");
	});

	it("recommends code group for debugging", () => {
		const route = routeTask("Debug this memory leak in the server process");
		expect(route?.groups).toContain("code");
	});

	// --- Automation ---
	it("detects automation tasks", () => {
		expect(
			routeTask("Automate the deployment pipeline for staging"),
		)?.toHaveProperty("type", "automation");
		expect(
			routeTask("Set up a cron job to check the API every 5 minutes"),
		)?.toHaveProperty("type", "automation");
		expect(
			routeTask("Monitor the service and alert when latency spikes"),
		)?.toHaveProperty("type", "automation");
	});

	it("recommends management, code, and web groups for automation", () => {
		const route = routeTask("Automate weekly report generation and schedule it");
		expect(route?.groups).toContain("management");
		expect(route?.groups).toContain("code");
		expect(route?.groups).toContain("web");
	});

	// --- Disambiguation ---
	it("picks highest-scoring type for mixed prompts", () => {
		// "research" signals are stronger than "coding" here
		const route = routeTask(
			"Research the best Python testing frameworks and compare alternatives",
		);
		expect(route?.type).toBe("research");
	});

	it("distinguishes debugging from coding", () => {
		// "bug" + "error" + "troubleshoot" = strong debugging signal
		const route = routeTask(
			"Troubleshoot the bug causing intermittent errors in the payment flow",
		);
		expect(route?.type).toBe("debugging");
	});

	// --- Strategy ---
	it("provides non-empty strategy for classified tasks", () => {
		const route = routeTask("Research the latest trends in AI agent architectures");
		expect(route).not.toBeNull();
		expect(route!.strategy.length).toBeGreaterThan(20);
	});

	it("strategy differs by task type", () => {
		const research = routeTask("Research best practices for caching");
		const coding = routeTask("Implement a caching layer for the API");
		expect(research?.strategy).not.toBe(coding?.strategy);
	});
});

describe("formatTaskHint", () => {
	it("returns empty string for null route", () => {
		expect(formatTaskHint(null)).toBe("");
	});

	it("formats route as compact hint", () => {
		const hint = formatTaskHint({
			type: "research",
			groups: ["web"],
			strategy: "Search multiple sources.",
		});
		expect(hint).toContain("[Task: research");
		expect(hint).toContain("Search multiple sources.");
	});

	it("replaces underscores with spaces in type name", () => {
		const hint = formatTaskHint({
			type: "data_analysis",
			groups: ["code"],
			strategy: "Inspect data first.",
		});
		expect(hint).toContain("data analysis");
		expect(hint).not.toContain("data_analysis");
	});

	it("starts with newlines for clean appending", () => {
		const hint = formatTaskHint({
			type: "coding",
			groups: [],
			strategy: "Test after changes.",
		});
		expect(hint.startsWith("\n\n")).toBe(true);
	});
});
