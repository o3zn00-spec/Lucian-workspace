import React from 'react';
import { createRoot } from 'react-dom/client';
import { LilithMessage } from '../../src/components/chat/lilith-chat-ui';
import { useSharedAIConfig } from '../../src/store/shared-ai-config';
Object.assign(window, { changeFixtureModel: () => useSharedAIConfig.getState().setGlobalModel('changed-fixture') });
useSharedAIConfig.getState().setGlobalProvider('openrouter');
useSharedAIConfig.getState().setGlobalModel('fixture');
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl px-5 py-8"><h1 className="mb-8 text-xl font-semibold">Lilthe</h1><LilithMessage message={{id:'user',role:'user',content:'Prepare a session with $10.',status:'complete'}}/><LilithMessage message={{id:'question',role:'assistant',content:JSON.stringify({lilthe_ui:'question',question:'How long would you like me to manage this session?',options:['Today','One week','Choose a duration']}),status:'complete'}} onChoose={text => { document.getElementById('selection')!.textContent = text; }}/><p id="selection" role="status"/><LilithMessage message={{id:'review',role:'assistant',content:JSON.stringify({lilthe_ui:'trade_review',summary:'Your proposed session is ready for review. I will use only the approved capital and limits.'}),status:'complete'}}/><p className="mt-5 text-xs text-fg-muted">Isolated UI fixture. All server responses are mocked. No live account connection.</p></main>);
