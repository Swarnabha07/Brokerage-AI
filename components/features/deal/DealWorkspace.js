<Button
  variant="outline"
  size="sm"
  className="mt-4 w-full"
  onClick={() => {
    setCurrentDeal(deal);
    setAccepted(false);
    setError("");
  }}
  disabled={isPending}
>
  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
  simulation
</Button>
