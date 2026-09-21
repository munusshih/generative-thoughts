export function createConfirmationDialog({
  dialog,
  title,
  message,
  confirmButton,
}) {
  async function confirm({
    title: nextTitle,
    message: nextMessage,
    confirmLabel = "PROCEED",
  }) {
    if (!dialog || typeof dialog.showModal !== "function") {
      return window.confirm(nextMessage);
    }

    title.textContent = nextTitle;
    message.textContent = nextMessage;
    confirmButton.textContent = confirmLabel;
    dialog.returnValue = "cancel";
    dialog.showModal();

    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "confirm"),
        { once: true },
      );
    });
  }

  return { confirm };
}
