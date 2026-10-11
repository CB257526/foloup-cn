"use client";

import Modal from "@/components/dashboard/Modal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy } from "lucide-react";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";

interface SharePopupProps {
  open: boolean;
  onClose: () => void;
  shareContent: string;
}

function SharePopup({ open, onClose, shareContent }: SharePopupProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [url, setUrl] = useState<string>("加载中…");
  const [embedCode, setEmbedCode] = useState<string>("加载中…");
  const [activeTab, setActiveTab] = useState("copy");

  const [embedWidth, setEmbedWidth] = useState(1350);
  const [embedHeight, setEmbedHeight] = useState(735);

  useEffect(() => {
    const interviewURL = shareContent;
    if (interviewURL) {
      setUrl(interviewURL);
      setEmbedCode(
        `<iframe src="${interviewURL}" width="${embedWidth}" height="${embedHeight}"></iframe>`,
      );
    }
  }, [shareContent, embedWidth, embedHeight]);

  const copyLinkToClipboard = () => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopiedLink(true);
        toast.success("面试链接已复制到剪贴板。", {
          position: "bottom-right",
          duration: 3000,
        });

        setTimeout(() => setCopiedLink(false), 2000);
        setTimeout(() => onClose(), 1000);
      },

      (err) => console.error("Failed to copy", err.message),
    );
  };

  const copyEmbedToClipboard = () => {
    navigator.clipboard.writeText(embedCode).then(
      () => {
        setCopiedEmbed(true);
        toast.success("面试嵌入代码已复制到剪贴板。", {
          position: "bottom-right",
          duration: 3000,
        });

        setTimeout(() => setCopiedEmbed(false), 2000);
        setTimeout(() => onClose(), 1000);
      },
      (err) => console.error("Failed to copy", err.message),
    );
  };

  if (!open) {
    return null;
  }

  return (
    <Modal open={open} closeOnOutsideClick={false} onClose={onClose}>
      <div className="w-[28rem] flex flex-col">
        <p className="text-lg font-semibold mb-4">分享方式：</p>
        <div className="h-auto rounded-xl">
          <Tabs value={activeTab} className="flex flex-col h-full" onValueChange={setActiveTab}>
            <div className="w-auto">
              <TabsList>
                {/* <TabsTrigger value="mail">Mail</TabsTrigger> */}
                <TabsTrigger value="copy">链接</TabsTrigger>
                <TabsTrigger value="embed">嵌入代码</TabsTrigger>
              </TabsList>
            </div>
            <div>
              {/* <TabsContent value="mail" className="w-full"> </TabsContent> */}
              <TabsContent value="copy" className="w-full">
                <div className="mb-4">
                  <input
                    type="text"
                    value={url}
                    className="w-full p-2 border border-gray-300 bg-gray-100 rounded"
                    readOnly
                  />
                </div>
                <Button className="flex items-center bg-indigo-600" onClick={copyLinkToClipboard}>
                  <Copy size={16} className="mr-2" />
                  {copiedLink ? "已复制" : "复制链接"}
                </Button>
              </TabsContent>
              <TabsContent value="embed" className="w-full">
                <div className="mb-4">
                  <input
                    type="text"
                    value={embedCode}
                    className="w-full p-2 border border-gray-300 bg-gray-100 rounded"
                    readOnly
                  />
                </div>
                <div className="flex space-x-4 mb-4">
                  <div className="flex flex-col w-1/2">
                    <label htmlFor="width" className="mb-1">
                      宽度（像素）
                    </label>
                    <input
                      id="width"
                      type="number"
                      min="1050"
                      placeholder="宽度"
                      value={embedWidth}
                      className="w-full p-2 border border-gray-300 rounded"
                      onChange={(e) => setEmbedWidth(Number(e.target.value))}
                      onBlur={(e) => {
                        const value = Math.max(1050, Number(e.target.value));
                        setEmbedWidth(value);
                      }}
                    />
                  </div>
                  <div className="flex flex-col w-1/2">
                    <label htmlFor="height" className="mb-1">
                      高度（像素）
                    </label>
                    <input
                      id="height"
                      type="number"
                      min="700"
                      placeholder="高度"
                      value={embedHeight}
                      className="w-full p-2 border border-gray-300 rounded"
                      onChange={(e) => setEmbedHeight(Number(e.target.value))}
                      onBlur={(e) => {
                        const value = Math.max(700, Number(e.target.value));
                        setEmbedHeight(value);
                      }}
                    />
                  </div>
                </div>
                <Button className="flex items-center bg-indigo-600" onClick={copyEmbedToClipboard}>
                  <Copy size={16} className="mr-2" />
                  {copiedEmbed ? "已复制" : "复制嵌入代码"}
                </Button>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </Modal>
  );
}

export default SharePopup;