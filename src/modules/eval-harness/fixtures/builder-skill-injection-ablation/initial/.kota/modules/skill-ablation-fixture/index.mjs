const promptPath = ".kota/modules/skill-ablation-fixture/prompt.md";
const model = "claude-sonnet-4-6";

const variants = [
  {
    workflowName: "skill-ablation-no-skill",
    stepId: "solve-no-skill",
    agentName: "skill-ablation-no-skill-agent",
    skills: [],
  },
  {
    workflowName: "skill-ablation-focused-skill",
    stepId: "solve-focused-skill",
    agentName: "skill-ablation-focused-skill-agent",
    skills: ["kota-ticket-json-procedure"],
  },
  {
    workflowName: "skill-ablation-noisy-skill",
    stepId: "solve-noisy-skill",
    agentName: "skill-ablation-noisy-skill-agent",
    skills: ["kota-outdated-ticket-procedure"],
  },
];

function workflow(variant) {
  return {
    name: variant.workflowName,
    description: "Fixture-local workflow for one skill-ablation variant.",
    defaultAutonomyMode: "autonomous",
    triggers: [{ event: "manual" }],
    steps: [
      {
        id: variant.stepId,
        type: "agent",
        agentName: variant.agentName,
        promptPath,
        harness: "claude-agent-sdk",
        model,
        effort: "low",
        autonomyMode: "autonomous",
        maxTurns: 1,
        disallowedTools: [],
      },
    ],
  };
}

function agent(variant) {
  return {
    name: variant.agentName,
    role: "Solve the fixture ticket-normalization task for one skill-ablation variant.",
    promptPath,
    model,
    effort: "low",
    skills: variant.skills,
    writeScope: [],
  };
}

export default {
  name: "skill-ablation-fixture",
  description: "Fixture-local workflows and agents for eval-harness skill-ablation replay.",
  workflows: variants.map(workflow),
  agents: variants.map(agent),
};
