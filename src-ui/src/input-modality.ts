export function keyboardInteraction() {
  document.documentElement.dataset.input = "keyboard";
}

export function installInputModality() {
  const root = document.documentElement;
  const previous = root.dataset.input;
  keyboardInteraction();
  const pointer = () => { root.dataset.input = "pointer"; };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboardInteraction, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboardInteraction, true);
    if (previous === undefined) delete root.dataset.input;
    else root.dataset.input = previous;
  };
}
