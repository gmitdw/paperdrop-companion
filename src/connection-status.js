export function connectionStatus(state){
  const states={
    checking:{title:'Checking OneDrive…',text:'Receipts are saved on this device until upload is confirmed.',action:null},
    setup:{title:'Connect OneDrive to send receipts',text:'Complete this setup once. Until then, receipts stay only on this device.',action:'Connect OneDrive'},
    signin:{title:'Sign in required — uploads have stopped',text:'Microsoft needs you to sign in again. Your receipt folder is remembered. Saved receipts will upload after you sign in.',action:'Sign in to OneDrive'},
    folder:{title:'Choose your receipt folder',text:'Choose your shared RECEIPTS folder once to finish setup. Receipts have not uploaded yet.',action:'Choose receipt folder'},
    offline:{title:'Offline — receipts stay on this device',text:'Delivery will resume when you are online and PaperDrop is open.',action:'Retry delivery'},
    error:{title:'OneDrive delivery needs attention',text:'Delivery did not finish. Receipts marked Not uploaded remain only on this device.',action:'Retry delivery'},
    pending:{title:'Receipts have not uploaded',text:'Saved receipts are still on this device. Delivery has not been confirmed.',action:'Retry delivery'},
    stale:{title:'Shared collection could not be refreshed',text:'The document list may be out of date. Tap Retry delivery to check again.',action:'Retry delivery'},
    connected:{title:'OneDrive connected',text:'All locally saved receipts have uploaded. The Surface processes them when available.',action:null}
  };
  return states[state]||states.error;
}
