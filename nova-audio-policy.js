const NOVA_AUDIO_POLICY_VERSION='3.8.1';

(function(){
  if(!('speechSynthesis' in window)) return;
  const synth=window.speechSynthesis;
  if(synth.__novaTutorialOnly) return;

  const originalSpeak=synth.speak.bind(synth);
  synth.__novaTutorialOnly=true;
  synth.__novaOriginalSpeak=originalSpeak;

  const tutorialActive=()=>Boolean(
    document.querySelector('#novaSlideStage') ||
    document.querySelector('#adminBody.nova-slide-container')
  );

  synth.speak=function(utterance){
    if(tutorialActive()) return originalSpeak(utterance);
    queueMicrotask(()=>{
      try{
        if(typeof utterance?.onerror==='function'){
          utterance.onerror.call(utterance,{error:'canceled',utterance});
        }
      }catch{}
    });
  };

  const fixTutorialCopy=()=>{
    document.querySelectorAll('#novaSlideStage .nova-slide-do p').forEach(p=>{
      if(p.textContent?.includes('Al entrar escucharás “Bienvenido a Nova”')){
        p.textContent='Confirma que tu número de empleado quedó identificado.';
      }
    });
  };

  new MutationObserver(fixTutorialCopy).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',fixTutorialCopy,{once:true});
})();

console.info(`Nova Audio Policy ${NOVA_AUDIO_POLICY_VERSION}: solo tutorial`);
