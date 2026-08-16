import { AudioController, hookMediaElements } from './audio';

const controller = new AudioController();
hookMediaElements(controller);

document.addEventListener('volumute:set-volume', (e) => {
  const v = (e as CustomEvent<{ volume?: number }>).detail?.volume;
  if (typeof v === 'number') controller.setVolume(v);
});
