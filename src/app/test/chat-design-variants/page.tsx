"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, ThumbsUp, ThumbsDown, History, FileText, X, CheckCircle, Clock } from "lucide-react";
import MainLayout from "@/components/layouts/MainLayout";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: Array<{
    id: string;
    title: string;
    url?: string;
  }>;
}

// 시안 1: 미니멀 화이트
function Variant1_MinimalWhite() {
  const [messages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. 궁금한 점이 있으시면 자유롭게 질문해주세요.",
      timestamp: "방금 전",
    },
    {
      id: "2",
      type: "user",
      content: "인스타그램 광고 집행 정책이 궁금합니다.",
      timestamp: "1분 전",
    },
    {
      id: "3",
      type: "assistant",
      content: "인스타그램 광고 집행 정책에 대해 설명드리겠습니다.\n\n**주요 정책:**\n- 광고 콘텐츠는 Instagram 커뮤니티 가이드라인을 준수해야 합니다\n- 금지된 콘텐츠 유형을 포함할 수 없습니다\n- 타겟팅 옵션을 적절히 설정해야 합니다",
      timestamp: "1분 전",
      sources: [
        { id: "1", title: "Instagram 광고 정책 가이드", url: "#" },
        { id: "2", title: "Meta 광고 정책", url: "#" },
      ],
    },
  ]);
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">AI 챗봇</h1>
          <Button variant="outline" size="sm">
            <History className="w-4 h-4 mr-2" />
            히스토리
          </Button>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.type === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-blue-600" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                  message.type === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-gray-200 text-gray-900"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">출처:</p>
                    <div className="space-y-1">
                      {message.sources.map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          {source.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-400">{message.timestamp}</span>
                  {message.type === "assistant" && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-6 px-2">
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 px-2">
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {message.type === "user" && (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-gray-600" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end gap-3">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="메시지를 입력하세요..."
              className="flex-1 min-h-[60px] max-h-[120px] resize-none border-gray-300 focus:border-blue-500"
              rows={1}
            />
            <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6 h-[60px]">
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 시안 2: 다크 모드
function Variant2_DarkMode() {
  const [messages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. 궁금한 점이 있으시면 자유롭게 질문해주세요.",
      timestamp: "방금 전",
    },
    {
      id: "2",
      type: "user",
      content: "인스타그램 광고 집행 정책이 궁금합니다.",
      timestamp: "1분 전",
    },
    {
      id: "3",
      type: "assistant",
      content: "인스타그램 광고 집행 정책에 대해 설명드리겠습니다.\n\n**주요 정책:**\n- 광고 콘텐츠는 Instagram 커뮤니티 가이드라인을 준수해야 합니다\n- 금지된 콘텐츠 유형을 포함할 수 없습니다\n- 타겟팅 옵션을 적절히 설정해야 합니다",
      timestamp: "1분 전",
      sources: [
        { id: "1", title: "Instagram 광고 정책 가이드", url: "#" },
        { id: "2", title: "Meta 광고 정책", url: "#" },
      ],
    },
  ]);
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* 헤더 */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">AI 챗봇</h1>
          <Button variant="outline" size="sm" className="border-gray-600 text-gray-300 hover:bg-gray-700">
            <History className="w-4 h-4 mr-2" />
            히스토리
          </Button>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.type === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-blue-900 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-blue-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                  message.type === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 border border-gray-700 text-gray-100"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-400 mb-2">출처:</p>
                    <div className="space-y-1">
                      {message.sources.map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          {source.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-500">{message.timestamp}</span>
                  {message.type === "assistant" && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-gray-400 hover:text-gray-300 hover:bg-gray-700">
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-gray-400 hover:text-gray-300 hover:bg-gray-700">
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {message.type === "user" && (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-gray-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="bg-gray-800 border-t border-gray-700 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end gap-3">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="메시지를 입력하세요..."
              className="flex-1 min-h-[60px] max-h-[120px] resize-none bg-gray-900 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
              rows={1}
            />
            <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6 h-[60px]">
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 시안 3: 카드 기반
function Variant3_CardBased() {
  const [messages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. 궁금한 점이 있으시면 자유롭게 질문해주세요.",
      timestamp: "방금 전",
    },
    {
      id: "2",
      type: "user",
      content: "인스타그램 광고 집행 정책이 궁금합니다.",
      timestamp: "1분 전",
    },
    {
      id: "3",
      type: "assistant",
      content: "인스타그램 광고 집행 정책에 대해 설명드리겠습니다.\n\n**주요 정책:**\n- 광고 콘텐츠는 Instagram 커뮤니티 가이드라인을 준수해야 합니다\n- 금지된 콘텐츠 유형을 포함할 수 없습니다\n- 타겟팅 옵션을 적절히 설정해야 합니다",
      timestamp: "1분 전",
      sources: [
        { id: "1", title: "Instagram 광고 정책 가이드", url: "#" },
        { id: "2", title: "Meta 광고 정책", url: "#" },
      ],
    },
  ]);
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">AI 챗봇</h1>
          <Button variant="outline" size="sm">
            <History className="w-4 h-4 mr-2" />
            히스토리
          </Button>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.map((message) => (
            <Card
              key={message.id}
              className={`${
                message.type === "user"
                  ? "bg-blue-600 text-white border-blue-600 ml-auto"
                  : "bg-white border-gray-200"
              } max-w-[85%] shadow-md`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {message.type === "assistant" && (
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-6 h-6 text-blue-600" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold">
                        {message.type === "user" ? "사용자" : "AI 어시스턴트"}
                      </span>
                      <span className="text-xs opacity-70">{message.timestamp}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed mb-3">{message.content}</p>
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs font-semibold mb-2">출처</p>
                        <div className="space-y-2">
                          {message.sources.map((source) => (
                            <a
                              key={source.id}
                              href={source.url}
                              className="block text-xs text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-2 p-2 bg-blue-50 rounded-lg"
                            >
                              <FileText className="w-4 h-4" />
                              {source.title}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {message.type === "assistant" && (
                      <div className="flex gap-2 mt-3">
                        <Button variant="ghost" size="sm" className="h-7 px-3 text-xs">
                          <ThumbsUp className="w-3 h-3 mr-1" />
                          도움됨
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-3 text-xs">
                          <ThumbsDown className="w-3 h-3 mr-1" />
                          도움 안됨
                        </Button>
                      </div>
                    )}
                  </div>
                  {message.type === "user" && (
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-6 h-6 text-white" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="bg-white/80 backdrop-blur-sm border-t border-gray-200 px-6 py-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <Card className="border-gray-300 shadow-md">
            <CardContent className="p-4">
              <div className="flex items-end gap-3">
                <Textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="메시지를 입력하세요..."
                  className="flex-1 min-h-[60px] max-h-[120px] resize-none border-gray-300 focus:border-blue-500"
                  rows={1}
                />
                <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6 h-[60px] shadow-md">
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// 시안 4: 사이드바 통합
function Variant4_SidebarIntegrated() {
  const [messages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. 궁금한 점이 있으시면 자유롭게 질문해주세요.",
      timestamp: "방금 전",
    },
    {
      id: "2",
      type: "user",
      content: "인스타그램 광고 집행 정책이 궁금합니다.",
      timestamp: "1분 전",
    },
    {
      id: "3",
      type: "assistant",
      content: "인스타그램 광고 집행 정책에 대해 설명드리겠습니다.\n\n**주요 정책:**\n- 광고 콘텐츠는 Instagram 커뮤니티 가이드라인을 준수해야 합니다\n- 금지된 콘텐츠 유형을 포함할 수 없습니다\n- 타겟팅 옵션을 적절히 설정해야 합니다",
      timestamp: "1분 전",
      sources: [
        { id: "1", title: "Instagram 광고 정책 가이드", url: "#" },
        { id: "2", title: "Meta 광고 정책", url: "#" },
      ],
    },
  ]);
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 사이드바 */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900 mb-4">히스토리</h2>
          <div className="space-y-2">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100">
              <p className="text-sm font-medium text-gray-900">인스타그램 광고 정책</p>
              <p className="text-xs text-gray-500 mt-1">1분 전</p>
            </div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100">
              <p className="text-sm font-medium text-gray-900">네이버 광고 설정</p>
              <p className="text-xs text-gray-500 mt-1">2시간 전</p>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-gray-200 mt-auto">
          <Button variant="outline" className="w-full">
            <History className="w-4 h-4 mr-2" />
            전체 히스토리
          </Button>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="flex-1 flex flex-col">
        {/* 헤더 */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">AI 챗봇</h1>
        </div>

        {/* 메시지 영역 */}
        <div className="flex-1 overflow-y-auto px-6 py-8 bg-gray-50">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 ${message.type === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.type === "assistant" && (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-md">
                    <Bot className="w-6 h-6 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-xl px-4 py-3 ${
                    message.type === "user"
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-white border border-gray-200 text-gray-900 shadow-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs font-semibold text-gray-600 mb-2">출처</p>
                      <div className="space-y-1">
                        {message.sources.map((source) => (
                          <a
                            key={source.id}
                            href={source.url}
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" />
                            {source.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-400">{message.timestamp}</span>
                    {message.type === "assistant" && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-2">
                          <ThumbsUp className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 px-2">
                          <ThumbsDown className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {message.type === "user" && (
                  <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-gray-700" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 입력 영역 */}
        <div className="bg-white border-t border-gray-200 px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-3">
              <Textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="메시지를 입력하세요..."
                className="flex-1 min-h-[60px] max-h-[120px] resize-none border-gray-300 focus:border-blue-500"
                rows={1}
              />
              <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6 h-[60px]">
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 시안 5: 컴팩트 모바일 우선
function Variant5_CompactMobile() {
  const [messages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. 궁금한 점이 있으시면 자유롭게 질문해주세요.",
      timestamp: "방금 전",
    },
    {
      id: "2",
      type: "user",
      content: "인스타그램 광고 집행 정책이 궁금합니다.",
      timestamp: "1분 전",
    },
    {
      id: "3",
      type: "assistant",
      content: "인스타그램 광고 집행 정책에 대해 설명드리겠습니다.\n\n**주요 정책:**\n- 광고 콘텐츠는 Instagram 커뮤니티 가이드라인을 준수해야 합니다\n- 금지된 콘텐츠 유형을 포함할 수 없습니다",
      timestamp: "1분 전",
      sources: [
        { id: "1", title: "Instagram 광고 정책 가이드", url: "#" },
      ],
    },
  ]);
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">AI 챗봇</h1>
            <p className="text-xs text-gray-500">온라인</p>
          </div>
        </div>
        <Button variant="ghost" size="sm">
          <History className="w-4 h-4" />
        </Button>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.type === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  message.type === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-300">
                    <div className="space-y-1">
                      {message.sources.map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          {source.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-400">{message.timestamp}</span>
                  {message.type === "assistant" && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-5 px-1">
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 px-1">
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {message.type === "user" && (
                <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-gray-700" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="메시지 입력..."
            className="flex-1 min-h-[50px] max-h-[100px] resize-none border-gray-300 text-sm"
            rows={1}
          />
          <Button className="bg-blue-600 hover:bg-blue-700 text-white px-4 h-[50px]">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ChatDesignVariantsPage() {
  const variants = [
    { id: 1, name: "미니멀 화이트", component: Variant1_MinimalWhite, description: "깔끔한 화이트 배경의 미니멀 디자인" },
    { id: 2, name: "다크 모드", component: Variant2_DarkMode, description: "세련된 다크 테마" },
    { id: 3, name: "카드 기반", component: Variant3_CardBased, description: "카드 형태의 메시지 디자인" },
    { id: 4, name: "사이드바 통합", component: Variant4_SidebarIntegrated, description: "히스토리 사이드바가 통합된 레이아웃" },
    { id: 5, name: "컴팩트 모바일", component: Variant5_CompactMobile, description: "모바일 우선의 컴팩트 디자인" },
  ];

  return (
    <MainLayout>
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Chat 페이지 디자인 시안
            </h1>
            <p className="text-lg text-gray-600">
              다양한 스타일의 심플하고 세련된 채팅 인터페이스를 비교해보세요
            </p>
          </motion.div>

          <div className="space-y-16">
            {variants.map((variant, index) => {
              const Component = variant.component;
              return (
                <motion.div
                  key={variant.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                >
                  <Card className="bg-white shadow-xl border-0 overflow-hidden">
                    <CardHeader className="bg-gray-50 border-b">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-2xl text-gray-900 mb-2">
                            시안 {variant.id}: {variant.name}
                          </CardTitle>
                          <p className="text-gray-600">{variant.description}</p>
                        </div>
                        <Badge variant="outline" className="border-blue-500 text-blue-600">
                          {variant.id === 1 ? "추천" : "새 시안"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="border-t border-gray-200 h-[600px] overflow-hidden">
                        <Component />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <motion.div
            className="mt-16 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-6">
                <p className="text-gray-700">
                  💡 <strong>팁:</strong> 각 시안의 전체 레이아웃과 메시지 스타일을 확인하세요.
                  <br />
                  원하는 시안을 선택하면 Chat 페이지에 적용할 수 있습니다.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </MainLayout>
  );
}

