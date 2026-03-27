import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
	build: {
		lib: {
			entry: {
				"memory-graph": resolve(__dirname, "src/index.tsx"),
				"mock-data": resolve(__dirname, "src/mock-data.ts"),
			},
			formats: ["es", "cjs"],
		},
		rollupOptions: {
			external: ["react", "react-dom", "react/jsx-runtime"],
			output: {
				globals: {
					react: "React",
					"react-dom": "ReactDOM",
				},
			},
		},
		sourcemap: true,
		minify: false,
	},
})
