import React, { useId, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "@phosphor-icons/react";

export function JoinQrCode({ joinUrl, roomCode }: { joinUrl: string; roomCode: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <div className="join-qr">
      <button className="join-qr__expand" type="button" aria-label="参加用QRコードを拡大" aria-haspopup="dialog" aria-controls={id}
        onClick={() => dialog.current?.showModal()}>
        <QRCodeSVG value={joinUrl} size={144} marginSize={4} level="M" aria-hidden="true" />
        <span>QRコードを拡大</span>
      </button>
      <dialog ref={dialog} id={id} className="qr-modal" aria-labelledby={`${id}-title`} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current?.close();
      }}>
        <button className="qr-modal__close icon-button" type="button" aria-label="閉じる" onClick={() => dialog.current?.close()} autoFocus>
          <X size={24} aria-hidden="true" />
        </button>
        <h2 id={`${id}-title`}>参加用QRコード</h2>
        <QRCodeSVG value={joinUrl} size={360} marginSize={4} level="M" role="img" aria-label="参加URLのQRコード" />
        <p className="qr-modal__code">{roomCode}</p>
      </dialog>
    </div>
  );
}
