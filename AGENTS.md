<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 🛑 CRITICAL ISOLATION PROTOCOL (MASTER RULE) 🛑

1. **NO INTERACTION WITH MAIN PROJECT REPO**: Under NO circumstances should any code, script, or agent action read from, write to, or otherwise interact with the original `flyfast` main project directory or its GitHub repository. All local work must be strictly contained within `/Users/ron/Developer/flyfast_v2`.
2. **NO INTERACTION WITH ORIGINAL FLYFAST FIREBASE**: You are strictly forbidden from interacting with, modifying, deploying to, or querying the original production `flyfast` Firebase/Firestore project or any of its associated external services. The live FlyFast iOS app depends on that backend and cannot be disrupted.
3. **USE ONLY 'flyfast-v2' FIREBASE**: The *only* Firebase project you are permitted to read from, write to, or configure is the newly created v2 project: `flyfast-v2` (https://console.firebase.google.com/u/0/project/flyfast-v2/firestore/databases/-default-/data). Always verify the target Firebase project is explicitly `flyfast-v2` before executing any database, configuration, or deployment commands.
4. **TERMINAL INSTRUCTIONS**: Always include the full directory path and a `cd` command (e.g., `cd /Users/ron/Developer/flyfast_v2`) in any terminal instructions provided to the user.
