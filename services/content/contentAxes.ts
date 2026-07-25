import {
  AxisOption,
  ContentApproach,
  ContentAudience,
  ContentBrief,
  ContentIntent,
  ContentVoice,
} from '../../types/content';

/**
 * Bốn trục điều khiển sáng tạo.
 *
 * Mỗi lựa chọn mang theo một `directive` — câu chỉ dẫn được ghép thẳng vào
 * prompt. Nhãn và mô tả là để người dùng chọn; `directive` mới là thứ thực sự
 * đổi được đầu ra. Viết directive ở dạng mệnh lệnh, cụ thể, nói rõ phải làm gì
 * chứ không tả tính từ chung chung, vì mô hình bám vào chỉ dẫn hành động tốt
 * hơn nhiều so với bám vào hình dung trừu tượng.
 */

export const INTENT_OPTIONS: AxisOption<ContentIntent>[] = [
  {
    value: 'awareness',
    label: 'Gây nhận biết',
    description: 'Để người chưa biết gì về chủ đề dừng lại và quan tâm',
    directive:
      'Viết cho người chưa từng quan tâm chủ đề này. Mở bài phải nêu được vì sao chuyện đó liên quan tới họ trong hai câu đầu. Không giả định người đọc có kiến thức nền. Không kêu gọi mua bán.',
  },
  {
    value: 'education',
    label: 'Giải thích',
    description: 'Để người đọc hiểu được một thứ họ đang mơ hồ',
    directive:
      'Mục tiêu là người đọc hiểu, không phải người đọc trầm trồ. Giải thích khái niệm khó bằng ví dụ đời thường Việt Nam. Mỗi ý lớn phải có một ví dụ cụ thể. Nêu cả điều kiện áp dụng và trường hợp ngoại lệ.',
  },
  {
    value: 'conversion',
    label: 'Thúc đẩy hành động',
    description: 'Để người đang cân nhắc ra quyết định',
    directive:
      'Người đọc đã biết vấn đề và đang cân nhắc. Tập trung gỡ đúng những rào cản khiến họ chần chừ. Nêu lợi ích bằng kết quả đo được, không bằng tính từ. Kết bài bằng một bước tiếp theo duy nhất và rõ ràng. Không thổi phồng, không hứa điều không kiểm chứng được.',
  },
  {
    value: 'community',
    label: 'Khơi chuyện',
    description: 'Để người đọc muốn bình luận và chia sẻ',
    directive:
      'Đích đến là phần bình luận. Nêu một góc nhìn có thể tranh luận được, thừa nhận phía đối lập có lý ở điểm nào. Kết bằng một câu hỏi mở gắn với trải nghiệm cá nhân của người đọc. Tránh giọng dạy đời.',
  },
];

export const APPROACH_OPTIONS: AxisOption<ContentApproach>[] = [
  {
    value: 'story',
    label: 'Kể chuyện',
    description: 'Vào bài bằng một con người cụ thể',
    directive:
      'Mở bằng một nhân vật cụ thể trong một tình huống cụ thể, có thời gian và địa điểm. Để thông tin lộ ra qua diễn biến câu chuyện thay vì liệt kê. Chỉ rút ra bài học ở cuối, ngắn gọn.',
  },
  {
    value: 'howto',
    label: 'Hướng dẫn',
    description: 'Các bước làm được ngay',
    directive:
      'Chia thành các bước đánh số, mỗi bước là một hành động làm được ngay. Nêu rõ cần chuẩn bị gì trước khi bắt đầu. Mỗi bước cảnh báo lỗi hay gặp. Không lý thuyết dài dòng ở đầu bài.',
  },
  {
    value: 'contrarian',
    label: 'Nói ngược',
    description: 'Thách thức một điều ai cũng tin',
    directive:
      'Nêu rõ quan niệm phổ biến ngay đầu bài, rồi chỉ ra nó sai hoặc thiếu ở đâu, kèm bằng chứng. Phải thừa nhận quan niệm đó đúng trong hoàn cảnh nào. Nói ngược để làm rõ vấn đề, không phải để gây sốc.',
  },
  {
    value: 'listicle',
    label: 'Danh sách',
    description: 'Nhiều ý ngắn, dễ lướt',
    directive:
      'Từ năm đến chín mục, mỗi mục có tiêu đề riêng và đứng độc lập được. Sắp theo thứ tự giá trị giảm dần, mục mạnh nhất lên đầu. Mỗi mục ba đến năm câu, không dài hơn.',
  },
  {
    value: 'casestudy',
    label: 'Phân tích tình huống',
    description: 'Mổ xẻ một trường hợp có thật',
    directive:
      'Theo bố cục bối cảnh, vấn đề, cách xử lý, kết quả, điều rút ra. Ưu tiên số liệu cụ thể. Nói rõ điều gì áp dụng được cho người đọc và điều gì chỉ đúng trong hoàn cảnh riêng của trường hợp này.',
  },
  {
    value: 'mythbust',
    label: 'Bóc lầm tưởng',
    description: 'Sửa những hiểu sai phổ biến',
    directive:
      'Mỗi phần nêu một lầm tưởng, giải thích vì sao nhiều người tin như vậy, rồi mới đưa thông tin đúng kèm nguồn gốc lý lẽ. Không chế giễu người đang hiểu sai.',
  },
  {
    value: 'explainer',
    label: 'Cắt nghĩa',
    description: 'Làm rõ một chuyện đang nóng',
    directive:
      'Trả lời theo thứ tự: chuyện gì đang xảy ra, vì sao xảy ra lúc này, ai bị ảnh hưởng, tiếp theo sẽ ra sao. Phân biệt rạch ròi đâu là điều đã xác nhận, đâu là suy đoán.',
  },
  {
    value: 'interview',
    label: 'Hỏi đáp',
    description: 'Dạng câu hỏi và câu trả lời',
    directive:
      'Dựng thành các cặp hỏi đáp. Câu hỏi phải là câu người đọc thật sự sẽ hỏi, viết bằng lời của họ. Câu trả lời đi thẳng vào vấn đề ngay câu đầu rồi mới mở rộng.',
  },
];

export const VOICE_OPTIONS: AxisOption<ContentVoice>[] = [
  {
    value: 'than_mat',
    label: 'Thân mật',
    description: 'Như đang nói chuyện với bạn',
    directive:
      'Xưng hô gần gũi, câu ngắn, dùng từ đời thường. Được phép dùng câu hỏi tu từ và cách nói khẩu ngữ. Tránh từ Hán Việt nặng nề khi có từ thuần Việt thay được.',
  },
  {
    value: 'chuyen_gia',
    label: 'Chuyên gia',
    description: 'Chắc chắn, có căn cứ',
    directive:
      'Giọng điềm tĩnh và chắc chắn. Mỗi khẳng định phải có căn cứ. Dùng thuật ngữ chuyên ngành khi cần nhưng giải thích ngay lần đầu xuất hiện. Không cường điệu, không dùng dấu chấm than.',
  },
  {
    value: 'hai_huoc',
    label: 'Hài hước',
    description: 'Nhẹ nhàng, có duyên',
    directive:
      'Cài cái hài vào cách quan sát và so sánh, không phải vào việc chêm từ đùa. Cái hài phải làm rõ ý chứ không được lấn át thông tin. Không mỉa mai người đọc.',
  },
  {
    value: 'truyen_cam',
    label: 'Truyền cảm',
    description: 'Chạm được vào cảm xúc',
    directive:
      'Dùng chi tiết cụ thể để gợi cảm xúc, không dùng tính từ để tuyên bố cảm xúc. Thay vì nói một chuyện cảm động thì hãy kể chi tiết khiến người đọc tự thấy cảm động. Tiết chế, không lên gân.',
  },
  {
    value: 'sac_lanh',
    label: 'Sắc lạnh',
    description: 'Gọn, thẳng, không màu mè',
    directive:
      'Câu ngắn, cắt hết chữ thừa. Không mở bài rào đón. Nêu sự việc và hệ quả, để người đọc tự đánh giá. Không dùng trạng từ tăng cấp như rất, cực kỳ, vô cùng.',
  },
  {
    value: 'moc_mac',
    label: 'Mộc mạc',
    description: 'Giản dị, không hoa mỹ',
    directive:
      'Dùng từ đơn giản nhất diễn đạt được ý. Câu thẳng, ít mệnh đề phụ. Không ẩn dụ cầu kỳ. Viết như đang giải thích cho người thân trong nhà.',
  },
];

export const AUDIENCE_OPTIONS: AxisOption<ContentAudience>[] = [
  {
    value: 'gen_z',
    label: 'Gen Z',
    description: 'Người trẻ, lớn lên cùng mạng xã hội',
    directive:
      'Người đọc trẻ, quen lướt nhanh, nhạy với giọng quảng cáo. Vào thẳng vấn đề, đoạn ngắn. Được dùng cách nói của mạng xã hội nhưng phải tự nhiên, đừng cố bắt trend. Tuyệt đối không lên giọng người lớn.',
  },
  {
    value: 'van_phong',
    label: 'Dân văn phòng',
    description: 'Bận, cần áp dụng được ngay',
    directive:
      'Người đọc ít thời gian. Nêu kết luận trước, lý lẽ sau. Ưu tiên thứ áp dụng được trong công việc hằng ngày. Nêu rõ tốn bao lâu và cần gì để làm theo.',
  },
  {
    value: 'chu_doanh_nghiep',
    label: 'Chủ doanh nghiệp',
    description: 'Quan tâm chi phí, rủi ro, hiệu quả',
    directive:
      'Quy mọi thứ về chi phí, rủi ro và hiệu quả. Nêu con số khi có. Nói rõ điều kiện áp dụng theo quy mô doanh nghiệp. Không nói lý thuyết quản trị chung chung.',
  },
  {
    value: 'phu_huynh',
    label: 'Phụ huynh',
    description: 'Quan tâm con cái và gia đình',
    directive:
      'Người đọc lo cho con. Giọng đồng cảm, không phán xét cách nuôi dạy. Đưa lời khuyên làm được trong hoàn cảnh gia đình Việt Nam. Với nội dung sức khoẻ hay giáo dục, nói rõ khi nào cần gặp chuyên gia.',
  },
  {
    value: 'ky_thuat',
    label: 'Dân kỹ thuật',
    description: 'Đọc kỹ, ghét nói vống',
    directive:
      'Người đọc phát hiện ngay chỗ nói vống. Chính xác về mặt kỹ thuật, nêu rõ giới hạn và đánh đổi. Được dùng thuật ngữ đúng nghĩa. Không đơn giản hoá tới mức sai.',
  },
  {
    value: 'pho_thong',
    label: 'Phổ thông',
    description: 'Không giả định kiến thức nền',
    directive:
      'Không giả định người đọc biết trước điều gì. Giải thích mọi thuật ngữ ngay lần đầu dùng. Ví dụ lấy từ đời sống thường ngày. Tránh viết tắt.',
  },
];

const findOption = <T extends string>(options: AxisOption<T>[], value: T): AxisOption<T> => {
  const option = options.find((item) => item.value === value);
  if (!option) throw new Error(`Giá trị không hợp lệ trên trục: ${value}`);
  return option;
};

export const getIntent = (value: ContentIntent) => findOption(INTENT_OPTIONS, value);
export const getApproach = (value: ContentApproach) => findOption(APPROACH_OPTIONS, value);
export const getVoice = (value: ContentVoice) => findOption(VOICE_OPTIONS, value);
export const getAudience = (value: ContentAudience) => findOption(AUDIENCE_OPTIONS, value);

/** Brief mặc định, dùng khi người dùng chỉ chọn chủ đề rồi bấm chạy. */
export const createDefaultBrief = (topic: string): ContentBrief => ({
  topic,
  intent: 'awareness',
  approach: 'explainer',
  voice: 'than_mat',
  audience: 'pho_thong',
  keywords: [],
  targetWords: 900,
});

/** Gom bốn directive thành khối chỉ dẫn đưa vào prompt. */
export const buildAxisDirectives = (brief: ContentBrief): string =>
  [
    `Mục tiêu — ${getIntent(brief.intent).label}: ${getIntent(brief.intent).directive}`,
    `Góc tiếp cận — ${getApproach(brief.approach).label}: ${getApproach(brief.approach).directive}`,
    `Giọng — ${getVoice(brief.voice).label}: ${getVoice(brief.voice).directive}`,
    `Người đọc — ${getAudience(brief.audience).label}: ${getAudience(brief.audience).directive}`,
  ].join('\n\n');
