import type { GraphThemeColors } from "./types"

export const MEMORY_BORDER_KEYS = {
	forgotten: "memBorderForgotten",
	expiring: "memBorderExpiring",
	recent: "memBorderRecent",
	default: "memStrokeDefault",
} as const

export const FORCE_CONFIG = {
	linkStrength: {
		docMemory: 0.8,
		version: 1.0,
		docDocBase: 0.3,
	},
	linkDistance: 300,
	docMemoryDistance: 150,
	chargeStrength: -1000,
	collisionRadius: { document: 80, memory: 40 },
	alphaDecay: 0.04,
	alphaMin: 0.001,
	velocityDecay: 0.6,
	alphaTarget: 0.3,
	preSettleTicks: 100,
}

export const GRAPH_SETTINGS = {
	console: { initialZoom: 0.8, initialPanX: 0, initialPanY: 0 },
	consumer: { initialZoom: 0.5, initialPanX: 400, initialPanY: 300 },
}

export const ANIMATION = {
	dimDuration: 1500,
}

export const DEFAULT_COLORS: GraphThemeColors = {
	bg: "#0f1419",
	docFill: "#1B1F24",
	docStroke: "#2A2F36",
	docInnerFill: "#13161A",
	memFill: "#0D2034",
	memFillHover: "#112840",
	memStrokeDefault: "#3B73B8",
	accent: "#3B73B8",
	textPrimary: "#ffffff",
	textSecondary: "#e2e8f0",
	textMuted: "#94a3b8",
	edgeDocMemory: "#4A5568",
	edgeVersion: "#8B5CF6",
	edgeSameSpace: "#4A6A8A",
	memBorderForgotten: "#EF4444",
	memBorderExpiring: "#F59E0B",
	memBorderRecent: "#10B981",
	glowColor: "#3B73B8",
	iconColor: "#3B73B8",
	popoverBg: "#1a1f29",
	popoverBorder: "#2A2F36",
	popoverTextPrimary: "#ffffff",
	popoverTextSecondary: "#e2e8f0",
	popoverTextMuted: "#94a3b8",
	controlBg: "#1a1f29",
	controlBorder: "#2A2F36",
}
