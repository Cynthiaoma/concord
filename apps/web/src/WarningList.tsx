import { Notice } from "./ui";

export function WarningList({ warnings }: { warnings: readonly string[] }) {
  return (
    <>
      {warnings.map((warning, index) => (
        <Notice key={index + "-" + warning}>{warning}</Notice>
      ))}
    </>
  );
}
