<script>
	import '../app.css';
</script>

<div class="app">
	<header class="flex flex-col w-full sticky top-0 left-0">
		<div class="flex px-8 py-6 bg-background/65 backdrop-blur">
			<h1 class="text-2xl font-bold">
				<a href="/">#liquiditystr</a>
			</h1>
		</div>
	</header>

	<main class="flex flex-col items-center px-8 py-4 gap-4 w-full min-h-screen">
		<slot />
	</main>
</div>

<style>
	.app {
		@apply bg-background text-foreground;
	}
</style>
