import { ScriptData, Shot } from "../types";

export const MOCK_SCRIPT: ScriptData = {
  title: 'Mưa Neon',
  genre: 'Trinh thám viễn tưởng',
  logline: 'Một thám tử người máy đào ngũ truy tìm người đã tạo ra mình giữa thành phố không bao giờ ngủ.',
  characters: [
    { id: 'c1', name: 'Minh', gender: 'Nam', age: 'Ngoài 30 (người máy)', personality: 'Điềm tĩnh, u hoài', visualPrompt: 'Thám tử người máy phong cách viễn tưởng công nghệ, mắt xanh phát sáng, áo khoác dài, thành phố neon ướt mưa phía sau, ánh sáng điện ảnh', variations: [] },
    { id: 'c2', name: 'Linh', gender: 'Nữ', age: '25', personality: 'Nổi loạn, chuyên gia an ninh mạng', visualPrompt: 'Cô gái chuyên gia an ninh mạng phong cách viễn tưởng công nghệ, tóc tím, kính thực tế tăng cường, trang phục đường phố chiến thuật, cầm bảng dữ liệu, ngõ hẻm neon', variations: [] }
  ],
  scenes: [
    { id: 's1', location: 'Ngõ Khu 7', time: 'Ban đêm', atmosphere: 'Mưa, ánh đèn neon', visualPrompt: 'Ngõ tối trong thành phố tương lai, mưa lớn, biển hiệu neon phản chiếu trên vũng nước, hơi nước bốc lên từ miệng thông gió, ánh sáng thể tích' }
  ],
  storyParagraphs: [
    { id: 1, text: 'Minh đứng dưới mưa, ngước nhìn bảng quảng cáo ba chiều.', sceneRefId: 's1' }
  ]
};

export const MOCK_SHOTS: Shot[] = [
  {
    id: "shot1",
    sceneId: "s1",
    actionSummary: 'Minh từ từ ngước nhìn lên.',
    cameraMovement: 'Ngẩng máy lên',
    characters: ["c1"],
    keyframes: [
      { id: 'kf1a', type: 'start', visualPrompt: 'Cảnh trung Minh cúi nhìn, mưa nhỏ từ vành mũ, ánh neon phản chiếu trên khuôn mặt', status: 'completed', imageUrl: 'https://picsum.photos/seed/kf1a/800/450' },
      { id: 'kf1b', type: 'end', visualPrompt: 'Cảnh trung Minh ngẩng đầu nhìn trời, ánh neon chiếu sáng toàn bộ khuôn mặt', status: 'pending' }
    ],
    interval: { id: "int1", startKeyframeId: "kf1a", endKeyframeId: "kf1b", duration: 3, motionStrength: 5, status: 'pending' }
  },
  {
    id: "shot2",
    sceneId: "s1",
    actionSummary: 'Linh bước ra khỏi bóng tối.',
    cameraMovement: 'Máy quay cố định',
    characters: ["c2"],
    keyframes: [
      { id: 'kf2a', type: 'start', visualPrompt: 'Toàn cảnh ngõ hẻm, bóng dáng Linh hiện ra từ làn hơi nước phía sau', status: 'pending' },
      { id: 'kf2b', type: 'end', visualPrompt: 'Toàn cảnh, Linh hiện rõ ở trung cảnh và cầm một thiết bị phát sáng', status: 'pending' }
    ],
    interval: { id: "int2", startKeyframeId: "kf2a", endKeyframeId: "kf2b", duration: 4, motionStrength: 3, status: 'pending' }
  }
];
