#!/bin/bash
TASKS="matplotlib__matplotlib-23314,matplotlib__matplotlib-22719,django__django-14539,sphinx-doc__sphinx-9602,django__django-14089,matplotlib__matplotlib-26342,pydata__xarray-2905,django__django-15022,django__django-13809,pydata__xarray-4075,instance_ansible__ansible-4c5ce5a1a9e79a845aff4978cfeb72a0d4ecf7d6-v1055803c3a812189a1133297f7f5468579283f86,yt-dlp__yt-dlp-5933,yt-dlp__yt-dlp-9862,django__django-15695,huggingface__transformers-27663,sveltejs__svelte-14629,instance_navidrome__navidrome-d8e794317f788198227e10fb667e10496b3eb99a,ponylang__ponyc-3962,nushell__nushell-13357,cli__cli-8157"
MODEL="us.anthropic.claude-opus-4-6-v1"

echo "=== off1500-p750-summ40-pc085 ==="
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --tasks "$TASKS" --config off1500-p750-summ40-pc085 --model "$MODEL" --output results-reproduce-pc085.json

echo "=== control ==="
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --tasks "$TASKS" --config control --model "$MODEL" --output results-reproduce-control.json

echo "=== off1500-p750-summ40 (ablation) ==="
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --tasks "$TASKS" --config off1500-p750-summ40 --model "$MODEL" --output results-reproduce-summ40.json

echo "Done. Run: python scripts/analyze.py"
