"use client";

import { parsePdf } from "@/actions/parse-pdf";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

type Props = {
  isUploaded: boolean;
  setIsUploaded: (isUploaded: boolean) => void;
  fileName: string;
  setFileName: (fileName: string) => void;
  setUploadedDocumentContext: (context: string) => void;
};

function FileUpload({
  isUploaded,
  setIsUploaded,
  fileName,
  setFileName,
  setUploadedDocumentContext,
}: Props) {
  const [uploading, setUploading] = useState(false);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getRootProps, getInputProps } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    onDrop: async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      setFileName(file.name);
      if (file.size > 10 * 1024 * 1024) {
        toast.error("请上传小于 10MB 的文件。", {
          position: "bottom-right",
          duration: 3000,
        });

        return;
      }

      try {
        setUploading(true);
        const formData = new FormData();
        formData.append("file", file);

        const result = await parsePdf(formData);
        if (!result.success) {
          throw new Error(result.error);
        }
        const fullText = result.text || "";
        setUploadedDocumentContext(fullText);
        setIsUploaded(true);
      } catch (error) {
        console.log(error);
        toast.error("读取 PDF 失败", {
          description: "请重试。",
          duration: 3000,
        });
      } finally {
        setUploading(false);
      }
    },
  });

  return (
    <div className="p-2 bg-white rounded-xl w-full h-24">
      {!isUploaded ? (
        <div
          {...getRootProps({
            className:
              "border-dashed border-2 rounded-xl cursor-pointer bg-gray-50 py-4 flex justify-center items-center flex-col",
          })}
        >
          <input {...getInputProps()} />
          <>
            <Inbox className="w-8 h-8 text-blue-500" />
            <p className="mt-2 text-sm text-slate-400">拖拽 PDF 到此处</p>
          </>
        </div>
      ) : (
        <div className="text-left">
          <p className="mt-2 text-sm text-slate-600">文件上传成功。{fileName}</p>
          <p className="mt-2 text-xs text-slate-600">
            是否要{" "}
            <button
              type="button"
              className="underline text-slate-950 cursor-pointer font-semibold"
              onClick={() => setIsUploaded(false)}
            >
              重新上传？
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

export default FileUpload;
