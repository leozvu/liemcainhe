import {
  ContentBrief,
  CreativeDirection,
  CreativeIntensity,
  CreativeLensKey,
  CreativeLensSelection,
} from '../../types/content';

export interface CreativeLensOption {
  id: string;
  label: string;
  description: string;
  directive: string;
}

export interface CreativeLens {
  key: CreativeLensKey;
  label: string;
  description: string;
  options: CreativeLensOption[];
}

/**
 * Mười lăm lăng kính do Egoric thiết kế cho nội dung thương mại Việt Nam.
 *
 * Không phải mười lăm ô phải điền. Chúng là một kho chiến thuật; mỗi hướng chỉ
 * lấy tối đa năm mục có ích nhất. Nội dung directive là nguồn sự thật duy nhất
 * cho cả giao diện và prompt.
 */
export const CREATIVE_LENSES: CreativeLens[] = [
  {
    key: 'hook',
    label: 'Cơ chế mở đầu',
    description: 'Lý do khiến người xem dừng lại trong hai câu đầu.',
    options: [
      { id: 'loi-ich-ngay', label: 'Lợi ích ngay', description: 'Đặt kết quả người đọc muốn lên trước.', directive: 'Mở bằng một kết quả cụ thể người đọc có thể nhận được; giải thích cơ chế ngay sau đó, không dùng lời hứa phóng đại.' },
      { id: 'khoang-trong', label: 'Khoảng trống tò mò', description: 'Cho biết điều quan trọng nhưng chưa bật mí hết.', directive: 'Mở ra một khoảng trống thông tin có thật, đủ để người đọc muốn biết tiếp; giải đáp trong nửa đầu nội dung, không câu giờ.' },
      { id: 'cau-hoi-that', label: 'Câu hỏi thật', description: 'Đúng câu khách hàng đang tự hỏi.', directive: 'Mở bằng một câu hỏi tự nhiên mà đúng nhóm khách hàng này thường tự hỏi; câu kế tiếp phải trả lời trực tiếp một phần.' },
      { id: 'chi-tiet-la', label: 'Chi tiết lạ', description: 'Một hình ảnh hoặc dữ kiện khó bỏ qua.', directive: 'Mở bằng một chi tiết quan sát cụ thể và bất ngờ, sau đó nối ngay chi tiết đó với vấn đề chính.' },
    ],
  },
  {
    key: 'tension',
    label: 'Lực căng',
    description: 'Mâu thuẫn giữ người đọc ở lại.',
    options: [
      { id: 'mong-muon-thuc-te', label: 'Mong muốn và thực tế', description: 'Khoảng cách giữa điều muốn và điều đang có.', directive: 'Xây nội dung quanh khoảng cách giữa kết quả người đọc muốn và thực tế họ đang gặp; chỉ ra nguyên nhân có thể hành động được.' },
      { id: 'duoc-mat', label: 'Được và mất', description: 'Một lựa chọn có đánh đổi rõ ràng.', directive: 'Đặt người đọc trước một lựa chọn có đánh đổi thật; trình bày cả lợi ích lẫn chi phí thay vì tạo đối lập giả.' },
      { id: 'cu-moi', label: 'Cách cũ và cách mới', description: 'Thói quen quen thuộc bị thách thức.', directive: 'Đối chiếu cách làm quen thuộc với một cách tiếp cận mới bằng cùng một tiêu chí; không chê bai cách cũ nếu chưa đủ bằng chứng.' },
      { id: 'noi-lam', label: 'Nói và làm', description: 'Khoảng cách giữa tuyên bố và hành vi.', directive: 'Làm rõ khoảng cách giữa điều thị trường thường nói và điều thực tế đang làm; dùng tình huống quan sát được, không công kích cá nhân.' },
    ],
  },
  {
    key: 'proof',
    label: 'Cách chứng minh',
    description: 'Căn cứ khiến thông điệp đáng tin.',
    options: [
      { id: 'minh-hoa', label: 'Minh hoạ trực tiếp', description: 'Cho thấy cách làm và kết quả.', directive: 'Chứng minh bằng một màn minh hoạ theo từng bước, để người đọc tự nhìn thấy kết quả thay vì chỉ nghe khẳng định.' },
      { id: 'tinh-huong', label: 'Tình huống thực tế', description: 'Một trường hợp có bối cảnh và kết quả.', directive: 'Dùng một tình huống thực tế có bối cảnh, quyết định và kết quả; không bịa tên, số liệu hay lời trích dẫn.' },
      { id: 'so-sanh', label: 'So sánh cùng chuẩn', description: 'Hai phương án trên cùng tiêu chí.', directive: 'So sánh các phương án trên cùng ba đến năm tiêu chí rõ ràng; nói cả điểm mạnh, điểm yếu và điều kiện phù hợp.' },
      { id: 'du-lieu-than-trong', label: 'Dữ liệu thận trọng', description: 'Số liệu có nguồn hoặc diễn đạt có điều kiện.', directive: 'Ưu tiên số liệu có thể kiểm chứng; nếu không có nguồn chắc chắn thì dùng mô tả định tính và nói rõ giới hạn, tuyệt đối không tự tạo con số.' },
    ],
  },
  {
    key: 'emotion',
    label: 'Đường cảm xúc',
    description: 'Trạng thái người xem đi qua từ đầu đến cuối.',
    options: [
      { id: 'dong-cam-hy-vong', label: 'Đồng cảm → hy vọng', description: 'Được thấu hiểu rồi thấy lối ra.', directive: 'Bắt đầu bằng việc gọi đúng cảm giác khó chịu của người đọc, sau đó chuyển dần sang một lối ra thực tế và vừa sức.' },
      { id: 'to-mo-vo-le', label: 'Tò mò → vỡ lẽ', description: 'Khám phá một cơ chế ẩn.', directive: 'Dẫn người đọc từ một hiện tượng quen thuộc tới nguyên nhân ít được chú ý; khoảnh khắc vỡ lẽ phải rõ và có ích.' },
      { id: 'ap-luc-nhe-nhom', label: 'Áp lực → nhẹ nhõm', description: 'Gỡ một nỗi lo cụ thể.', directive: 'Cho thấy áp lực cụ thể và hệ quả của nó, rồi tháo gỡ bằng một quy trình đơn giản; tránh hù dọa để bán hàng.' },
      { id: 'bat-ngo-ro-rang', label: 'Bất ngờ → rõ ràng', description: 'Đảo kỳ vọng rồi giải thích hợp lý.', directive: 'Tạo một sự đảo kỳ vọng có căn cứ, rồi giải thích thật sáng rõ để bất ngờ không biến thành giật gân.' },
    ],
  },
  {
    key: 'narrator',
    label: 'Vai người kể',
    description: 'Ai đang dẫn người đọc qua câu chuyện.',
    options: [
      { id: 'nguoi-trong-cuoc', label: 'Người trong cuộc', description: 'Kể từ trải nghiệm trực tiếp.', directive: 'Kể như người trực tiếp trải qua tình huống, dùng chi tiết nghề nghiệp và đời sống vừa đủ; không giả danh một người có thật.' },
      { id: 'khach-hang', label: 'Góc nhìn khách hàng', description: 'Bám theo hành trình ra quyết định.', directive: 'Đặt người đọc vào hành trình của một khách hàng điển hình: do dự, thử, đánh giá và quyết định; tránh biến nhân vật thành lời chứng thực giả.' },
      { id: 'chuyen-gia-dan-duong', label: 'Chuyên gia dẫn đường', description: 'Giải thích bình tĩnh, không lên lớp.', directive: 'Dẫn dắt bằng góc nhìn chuyên gia nhưng luôn giải thích lý do, giới hạn và cách áp dụng; không dùng uy quyền thay cho bằng chứng.' },
      { id: 'quan-sat-vien', label: 'Người quan sát', description: 'Nhìn rộng, giữ khoảng cách.', directive: 'Kể từ vị trí người quan sát, nối nhiều dấu hiệu nhỏ thành một bức tranh lớn; phân biệt rõ quan sát với suy luận.' },
    ],
  },
  {
    key: 'culture',
    label: 'Chất liệu Việt Nam',
    description: 'Bối cảnh văn hoá giúp nội dung gần và thật.',
    options: [
      { id: 'do-thi-duong-dai', label: 'Đô thị đương đại', description: 'Nhịp sống thành phố Việt Nam hôm nay.', directive: 'Dùng chi tiết đời sống đô thị Việt Nam hiện tại như di chuyển, công việc, hàng quán hoặc dịch vụ; tránh hình ảnh Việt Nam kiểu minh hoạ du lịch.' },
      { id: 'gia-dinh', label: 'Gia đình nhiều thế hệ', description: 'Quyết định chịu ảnh hưởng của người thân.', directive: 'Đặt vấn đề trong quan hệ gia đình Việt Nam nhiều thế hệ, tôn trọng khác biệt tuổi tác và không biến nhân vật lớn tuổi thành khuôn mẫu.' },
      { id: 'kinh-doanh-dia-phuong', label: 'Kinh doanh địa phương', description: 'Thực tế của cửa hàng và doanh nghiệp Việt.', directive: 'Gắn nội dung với vận hành thật của cửa hàng hoặc doanh nghiệp Việt Nam: dòng tiền, nhân sự, khách quen và uy tín địa phương.' },
      { id: 'cong-so', label: 'Văn hoá công sở', description: 'Những va chạm quen thuộc trong công việc.', directive: 'Dùng tình huống công sở Việt Nam có thật như họp, nhắn nhóm, deadline và phối hợp; hài hước vừa phải, không miệt thị nghề nghiệp.' },
    ],
  },
  {
    key: 'time',
    label: 'Khung thời gian',
    description: 'Cách thời gian tổ chức câu chuyện.',
    options: [
      { id: 'mot-ngay', label: 'Một ngày điển hình', description: 'Theo nhân vật qua một ngày.', directive: 'Tổ chức diễn biến theo các mốc trong một ngày điển hình; mỗi mốc phải làm vấn đề tiến thêm một bước.' },
      { id: 'truoc-sau', label: 'Trước và sau', description: 'Thấy rõ sự thay đổi.', directive: 'Đặt hai trạng thái trước và sau cạnh nhau trên cùng tiêu chí; giải thích bước chuyển ở giữa thay vì chỉ khoe kết quả.' },
      { id: 'ngay-luc-nay', label: 'Ngay lúc này', description: 'Tính thời sự và điều cần biết hôm nay.', directive: 'Tập trung vào điều đang thay đổi ngay lúc này, vì sao nó đáng chú ý và người đọc nên làm gì trong thời gian gần.' },
      { id: 'tuong-lai-gan', label: 'Tương lai gần', description: 'Một viễn cảnh đủ thực tế để hành động.', directive: 'Dựng một viễn cảnh trong tương lai gần dựa trên dấu hiệu hiện có; ghi rõ đâu là dự đoán, không trình bày như sự thật chắc chắn.' },
    ],
  },
  {
    key: 'setting',
    label: 'Không gian chính',
    description: 'Nơi câu chuyện diễn ra và có thể quay được.',
    options: [
      { id: 'ban-lam-viec', label: 'Bàn làm việc', description: 'Gọn, gần, tập trung vào thao tác.', directive: 'Đặt hành động quanh một bàn làm việc thật, ưu tiên chi tiết tay, màn hình và vật dụng; mọi cảnh phải quay được trong không gian nhỏ.' },
      { id: 'cua-hang', label: 'Cửa hàng hoặc studio', description: 'Có sản phẩm và tương tác trực tiếp.', directive: 'Dùng một cửa hàng, showroom hoặc studio làm sân khấu chính; để sản phẩm xuất hiện qua hành động tự nhiên, không trưng bày vô cớ.' },
      { id: 'duong-pho', label: 'Đường phố Việt Nam', description: 'Năng lượng đời sống và chuyển động.', directive: 'Dùng đường phố Việt Nam như bối cảnh sống, chọn chi tiết thị giác có thể kiểm soát khi quay; tránh cảnh đám đông hoặc địa danh khó xin phép.' },
      { id: 'khong-gian-nha', label: 'Không gian nhà', description: 'Thân mật, phù hợp chuyện cá nhân.', directive: 'Dùng không gian nhà ở Việt Nam với chi tiết đời thường; giữ sự riêng tư và tránh hình ảnh gia đình sáo mòn.' },
    ],
  },
  {
    key: 'format',
    label: 'Định dạng biểu đạt',
    description: 'Hình thức người xem nhận nội dung.',
    options: [
      { id: 'nhat-ky', label: 'Nhật ký ngắn', description: 'Diễn biến theo trải nghiệm cá nhân.', directive: 'Viết như một nhật ký ngắn có mốc diễn biến, quan sát và kết luận; mỗi đoạn phải thêm thông tin mới.' },
      { id: 'kiem-chung', label: 'Thử và kiểm chứng', description: 'Đặt một giả thuyết rồi kiểm tra.', directive: 'Bắt đầu bằng một giả thuyết, mô tả cách kiểm tra công bằng, cho thấy kết quả và điều chưa thể kết luận.' },
      { id: 'doi-thoai', label: 'Đối thoại', description: 'Hai góc nhìn va vào nhau.', directive: 'Tạo đối thoại giữa hai góc nhìn có lý lẽ riêng; mỗi lượt thoại ngắn, tự nhiên và làm mâu thuẫn tiến lên.' },
      { id: 'cam-nang', label: 'Cẩm nang hành động', description: 'Rõ bước, dễ lưu lại.', directive: 'Tổ chức thành một cẩm nang ngắn với thứ tự ưu tiên, điều kiện bắt đầu và lỗi cần tránh; nội dung phải dùng lại được.' },
    ],
  },
  {
    key: 'structure',
    label: 'Kết cấu',
    description: 'Bộ khung giữ logic nội dung.',
    options: [
      { id: 'van-de-giai-phap', label: 'Vấn đề → giải pháp', description: 'Đi thẳng từ nỗi đau tới cách xử lý.', directive: 'Đi theo bốn nhịp: vấn đề, nguyên nhân, giải pháp, bước đầu tiên; phần giải pháp phải dài hơn phần mô tả vấn đề.' },
      { id: 'mo-vong-ket-vong', label: 'Mở vòng → kết vòng', description: 'Chi tiết đầu bài trở lại ở cuối.', directive: 'Đặt một chi tiết chưa hoàn tất ở đầu và quay lại giải quyết nó ở cuối; phần giữa phải cung cấp đủ dữ kiện để cái kết xứng đáng.' },
      { id: 'ba-tang', label: 'Sự thật → ý nghĩa → hành động', description: 'Từ thông tin đến quyết định.', directive: 'Chia logic thành điều đã biết, điều nó có nghĩa với người đọc và một hành động cụ thể; không nhảy thẳng từ dữ kiện sang lời bán hàng.' },
      { id: 'so-sanh-quyet-dinh', label: 'So sánh → quyết định', description: 'Giúp chọn giữa các phương án.', directive: 'Nêu tiêu chí trước, so sánh các lựa chọn rồi đưa ra khuyến nghị theo từng hoàn cảnh; không tuyên bố một phương án tốt cho tất cả.' },
    ],
  },
  {
    key: 'rhythm',
    label: 'Nhịp nội dung',
    description: 'Tốc độ tiếp nhận và độ dồn của ý.',
    options: [
      { id: 'nhanh-gon', label: 'Nhanh và gọn', description: 'Đoạn ngắn, đổi ý nhanh.', directive: 'Giữ câu và đoạn ngắn, mỗi đoạn chỉ một ý; cắt mọi phần dẫn không tạo giá trị trong ba giây đầu.' },
      { id: 'can-bang', label: 'Cân bằng', description: 'Đủ nhanh để giữ chú ý, đủ sâu để tin.', directive: 'Xen kẽ câu kết luận ngắn với đoạn giải thích vừa phải; cứ hai ý thông tin phải có một ví dụ hoặc hình ảnh cụ thể.' },
      { id: 'tang-dan', label: 'Tăng dần', description: 'Mỗi phần mạnh hơn phần trước.', directive: 'Sắp ý theo cường độ tăng dần, để hệ quả và lợi ích lớn nhất xuất hiện gần cuối; không lặp lại cùng một mức độ.' },
      { id: 'dien-anh', label: 'Chậm kiểu điện ảnh', description: 'Ít ý, giàu chi tiết hình ảnh.', directive: 'Giảm số ý, kéo dài khoảnh khắc quan trọng bằng chi tiết cảm giác và hành động; vẫn phải có chuyển biến rõ, không chỉ tạo không khí.' },
    ],
  },
  {
    key: 'language',
    label: 'Chất ngôn ngữ',
    description: 'Cách câu chữ tạo cảm giác thương hiệu.',
    options: [
      { id: 'doi-thuong', label: 'Đời thường chuẩn Việt', description: 'Tự nhiên, không dịch máy.', directive: 'Dùng tiếng Việt đời thường nhưng đúng chuẩn, ưu tiên động từ cụ thể; bỏ những cụm nghe như dịch từ tiếng Anh.' },
      { id: 'bien-tap', label: 'Biên tập cao cấp', description: 'Sạch, chắc, có tiết chế.', directive: 'Viết như một biên tập viên giàu kinh nghiệm: câu sáng, từ chính xác, chuyển đoạn mượt và tuyệt đối không khoa trương.' },
      { id: 'dam-chat-social', label: 'Đậm chất social', description: 'Ngắn, trực diện, có nhịp nói.', directive: 'Dùng nhịp nói tự nhiên của mạng xã hội Việt Nam, xuống dòng đúng chỗ và tránh cố nhét tiếng lóng hoặc trend đã cũ.' },
      { id: 'goi-hinh', label: 'Gợi hình có kiểm soát', description: 'Có chất điện ảnh nhưng không lên gân.', directive: 'Ưu tiên hình ảnh, âm thanh và hành động cụ thể thay cho tính từ; tối đa một phép so sánh đáng nhớ trong mỗi phần.' },
    ],
  },
  {
    key: 'perspective',
    label: 'Điểm nhìn',
    description: 'Khoảng cách giữa nội dung và người xem.',
    options: [
      { id: 'toi', label: 'Ngôi tôi', description: 'Gần, có trách nhiệm với trải nghiệm.', directive: 'Dùng ngôi tôi cho trải nghiệm và nhận định cá nhân; không biến cảm nhận riêng thành sự thật chung.' },
      { id: 'ban', label: 'Nói trực tiếp với bạn', description: 'Cá nhân hoá và hướng hành động.', directive: 'Nói trực tiếp với người đọc bằng “bạn”, chỉ dùng khi lời khuyên thật sự liên quan; tránh phán đoán cảm xúc hoặc hoàn cảnh của họ.' },
      { id: 'nhan-vat', label: 'Theo một nhân vật', description: 'Thấy câu chuyện qua lựa chọn của nhân vật.', directive: 'Giữ điểm nhìn bám theo một nhân vật chính, chỉ kể điều nhân vật có thể biết hoặc cảm nhận trong thời điểm đó.' },
      { id: 'da-goc', label: 'Nhiều góc nhìn', description: 'Một vấn đề, nhiều bên liên quan.', directive: 'Cho hai hoặc ba bên liên quan cùng xuất hiện, mỗi bên có mục tiêu hợp lý; kết lại bằng điểm chung có thể hành động.' },
    ],
  },
  {
    key: 'participation',
    label: 'Hành vi sau nội dung',
    description: 'Điều người xem được mời làm tiếp theo.',
    options: [
      { id: 'binh-luan', label: 'Bình luận trải nghiệm', description: 'Mở cuộc trò chuyện thật.', directive: 'Kết bằng một câu hỏi cụ thể về trải nghiệm, cho phép nhiều câu trả lời đúng; không dùng câu hỏi mồi kiểu “bạn thấy đúng không”.' },
      { id: 'luu-lai', label: 'Lưu lại để dùng', description: 'Tạo giá trị tham khảo.', directive: 'Đưa ra một khung, danh sách hoặc quy trình đủ hữu ích để người đọc muốn lưu; kết bài nhắc đúng tình huống nên mở lại.' },
      { id: 'chia-se', label: 'Chia sẻ đúng người', description: 'Thông tin có ích cho một nhóm rõ ràng.', directive: 'Tạo một thông tin người đọc có lý do gửi cho một người cụ thể; lời mời chia sẻ phải nói rõ ai sẽ được lợi và vì sao.' },
      { id: 'nhan-tin', label: 'Nhắn tin tư vấn', description: 'Chuyển đổi mềm sang trao đổi riêng.', directive: 'Kết bằng lời mời nhắn tin với một lợi ích tư vấn rõ ràng, nói trước người dùng cần chuẩn bị thông tin gì; không tạo khan hiếm giả.' },
    ],
  },
  {
    key: 'visualMotif',
    label: 'Mô-típ hình ảnh',
    description: 'Một nguyên tắc thị giác giữ các cảnh nhất quán.',
    options: [
      { id: 'mot-vat-the', label: 'Một vật thể xuyên suốt', description: 'Vật quen thuộc nối đầu và cuối.', directive: 'Chọn một vật thể đời thường liên quan đến chủ đề làm điểm neo hình ảnh; cho vật thể thay đổi ý nghĩa từ đầu tới cuối.' },
      { id: 'doi-tay', label: 'Đôi tay đang làm', description: 'Hành động thật thay cho tạo dáng.', directive: 'Ưu tiên cận cảnh đôi tay thao tác với sản phẩm hoặc công việc; mỗi động tác phải truyền đạt một bước của câu chuyện.' },
      { id: 'bien-doi-khong-gian', label: 'Không gian biến đổi', description: 'Trạng thái trước và sau nhìn thấy được.', directive: 'Dùng thay đổi ánh sáng, bố trí hoặc mức độ ngăn nắp của cùng một không gian để thể hiện chuyển biến; tránh hiệu ứng không quay được.' },
      { id: 'chi-tiet-chat-lieu', label: 'Chi tiết chất liệu', description: 'Cận cảnh tạo cảm giác cao cấp.', directive: 'Dùng cận cảnh chất liệu, bề mặt, ánh sáng và âm thanh nhỏ để tạo cảm giác thật; luôn xen cảnh rộng để người xem không mất phương hướng.' },
    ],
  },
];

const lensMap = new Map(CREATIVE_LENSES.map((lens) => [lens.key, lens]));

export const MAX_ACTIVE_LENSES = 5;

export const getCreativeLens = (key: CreativeLensKey): CreativeLens => {
  const lens = lensMap.get(key);
  if (!lens) throw new Error(`Không tìm thấy lăng kính sáng tạo: ${key}`);
  return lens;
};

export const getCreativeLensOption = (selection: CreativeLensSelection): CreativeLensOption => {
  const lens = getCreativeLens(selection.lens);
  const option = lens.options.find((item) => item.id === selection.optionId);
  if (!option) throw new Error(`Lựa chọn không hợp lệ cho lăng kính ${lens.label}.`);
  return option;
};

const intensityLabel: Record<CreativeIntensity, string> = {
  an_toan: 'An toàn — bám chuẩn ngành và dễ duyệt',
  can_bang: 'Cân bằng — khác biệt nhưng vẫn dễ hiểu',
  tao_bao: 'Táo bạo — tương phản mạnh, không được giật gân hoặc lệch Brand Kit',
};

export const buildCreativeDirectionPromptContext = (direction?: CreativeDirection | null): string => {
  if (!direction?.selections.length) return '';
  const selections = direction.selections.slice(0, MAX_ACTIVE_LENSES).map((selection) => {
    const lens = getCreativeLens(selection.lens);
    const option = getCreativeLensOption(selection);
    return `- ${lens.label} — ${option.label}: ${option.directive}`;
  });
  return [
    'HƯỚNG SÁNG TẠO ĐÃ ĐƯỢC ĐẠO DIỄN CHỐT',
    `Tên hướng: ${direction.name}.`,
    `Lời hứa: ${direction.promise}`,
    `Cường độ: ${intensityLabel[direction.intensity]}.`,
    ...selections,
    'Các chỉ dẫn trên phải phối hợp thành một ý tưởng thống nhất. Nếu có xung đột, ưu tiên Brand Kit, mục tiêu và tính chính xác.',
  ].join('\n');
};

interface DirectionRecipe {
  id: string;
  name: string;
  promise: string;
  rationale: (brief: ContentBrief) => string;
  intensity: CreativeIntensity;
  selections: Array<[CreativeLensKey, string[]]>;
}

const RECIPES: DirectionRecipe[] = [
  {
    id: 'su-that-huu-ich', name: 'Sự thật hữu ích', promise: 'Biến chủ đề nóng thành nội dung đáng tin và đáng lưu.',
    rationale: (brief) => `Hợp với mục tiêu ${brief.intent === 'education' ? 'giải thích' : 'xây nhận biết'} và nhóm người đọc cần thấy căn cứ trước khi tin.`,
    intensity: 'an_toan',
    selections: [['hook', ['cau-hoi-that', 'chi-tiet-la']], ['proof', ['du-lieu-than-trong', 'so-sanh']], ['structure', ['ba-tang', 'so-sanh-quyet-dinh']], ['language', ['bien-tap', 'doi-thuong']], ['participation', ['luu-lai', 'chia-se']]],
  },
  {
    id: 'nguoi-that-chuyen-that', name: 'Người thật, chuyện thật', promise: 'Đưa thông điệp vào một hành trình có cảm xúc và có thể quay.',
    rationale: (brief) => `Hợp với góc ${brief.approach === 'story' ? 'kể chuyện đã chọn' : 'nhân vật hoá chủ đề'} để người xem nhớ tình huống thay vì chỉ nhớ thông tin.`,
    intensity: 'can_bang',
    selections: [['narrator', ['khach-hang', 'nguoi-trong-cuoc']], ['emotion', ['dong-cam-hy-vong', 'ap-luc-nhe-nhom']], ['time', ['mot-ngay', 'truoc-sau']], ['setting', ['ban-lam-viec', 'khong-gian-nha', 'cua-hang']], ['visualMotif', ['doi-tay', 'mot-vat-the']]],
  },
  {
    id: 'goc-nhin-nguoc', name: 'Góc nhìn ngược', promise: 'Tạo tranh luận bằng một mâu thuẫn có căn cứ, không giật gân.',
    rationale: (brief) => `Hợp với nội dung cần dừng lướt và kéo bình luận từ nhóm ${brief.audience.replaceAll('_', ' ')}.`,
    intensity: 'tao_bao',
    selections: [['hook', ['chi-tiet-la', 'khoang-trong']], ['tension', ['cu-moi', 'noi-lam']], ['format', ['doi-thoai', 'kiem-chung']], ['perspective', ['da-goc', 'ban']], ['participation', ['binh-luan', 'chia-se']]],
  },
  {
    id: 'tu-van-de-den-hanh-dong', name: 'Từ vấn đề đến hành động', promise: 'Gỡ rào cản và đưa người xem tới một bước tiếp theo rõ ràng.',
    rationale: (brief) => `Ưu tiên hiệu quả cho mục tiêu ${brief.intent === 'conversion' ? 'chuyển đổi' : 'hành động'} mà vẫn tránh lời hứa quá mức.`,
    intensity: 'can_bang',
    selections: [['tension', ['mong-muon-thuc-te', 'duoc-mat']], ['proof', ['minh-hoa', 'tinh-huong']], ['structure', ['van-de-giai-phap', 'so-sanh-quyet-dinh']], ['rhythm', ['nhanh-gon', 'can-bang']], ['participation', ['nhan-tin', 'luu-lai']]],
  },
  {
    id: 'chat-viet-duong-dai', name: 'Chất Việt đương đại', promise: 'Tạo cảm giác gần gũi Việt Nam mà không dùng khuôn mẫu du lịch.',
    rationale: () => 'Phù hợp khi hình ảnh, bối cảnh và cách nói cần thật với đời sống khách hàng Việt Nam hôm nay.',
    intensity: 'can_bang',
    selections: [['culture', ['do-thi-duong-dai', 'kinh-doanh-dia-phuong', 'cong-so']], ['setting', ['duong-pho', 'cua-hang', 'ban-lam-viec']], ['language', ['doi-thuong', 'dam-chat-social']], ['narrator', ['quan-sat-vien', 'nguoi-trong-cuoc']], ['visualMotif', ['chi-tiet-chat-lieu', 'doi-tay']]],
  },
];

const hashText = (value: string): number => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pick = <T,>(items: T[], seed: number): T => items[seed % items.length];

const recipePriority = (brief: ContentBrief): string[] => {
  if (brief.intent === 'conversion') return ['tu-van-de-den-hanh-dong', 'nguoi-that-chuyen-that', 'goc-nhin-nguoc'];
  if (brief.intent === 'education') return ['su-that-huu-ich', 'goc-nhin-nguoc', 'nguoi-that-chuyen-that'];
  if (brief.intent === 'community') return ['goc-nhin-nguoc', 'chat-viet-duong-dai', 'nguoi-that-chuyen-that'];
  if (brief.approach === 'story' || brief.approach === 'casestudy') return ['nguoi-that-chuyen-that', 'chat-viet-duong-dai', 'su-that-huu-ich'];
  return ['chat-viet-duong-dai', 'su-that-huu-ich', 'tu-van-de-den-hanh-dong'];
};

/**
 * Đề xuất hướng hoàn toàn xác định tại máy: không gọi model, không đốt credit.
 * Cùng một brief luôn cho cùng một bộ hướng, giúp checkpoint và test ổn định.
 */
export const suggestCreativeDirections = (brief: ContentBrief, count = 3): CreativeDirection[] => {
  const seed = hashText(`${brief.topic}|${brief.intent}|${brief.approach}|${brief.audience}`);
  const priority = recipePriority(brief);
  const ordered = [...priority, ...RECIPES.map((recipe) => recipe.id).filter((id) => !priority.includes(id))];
  return ordered.slice(0, Math.max(1, Math.min(count, RECIPES.length))).map((recipeId, recipeIndex) => {
    const recipe = RECIPES.find((item) => item.id === recipeId)!;
    const selections = recipe.selections.map(([lens, optionIds], selectionIndex) => ({
      lens,
      optionId: pick(optionIds, seed + recipeIndex * 17 + selectionIndex * 31),
    }));
    return {
      id: `${recipe.id}-${seed.toString(36)}`,
      name: recipe.name,
      promise: recipe.promise,
      rationale: recipe.rationale(brief),
      intensity: recipe.intensity,
      selections,
    };
  });
};

/** Thay hoặc bỏ một lăng kính, đồng thời giữ giới hạn năm mục. */
export const updateDirectionSelection = (
  direction: CreativeDirection,
  lens: CreativeLensKey,
  optionId: string,
): CreativeDirection => {
  const withoutLens = direction.selections.filter((item) => item.lens !== lens);
  if (!optionId) return { ...direction, selections: withoutLens };
  getCreativeLensOption({ lens, optionId });
  if (withoutLens.length >= MAX_ACTIVE_LENSES) {
    throw new Error(`Mỗi hướng chỉ dùng tối đa ${MAX_ACTIVE_LENSES} lăng kính. Hãy bỏ một mục trước.`);
  }
  return { ...direction, selections: [...withoutLens, { lens, optionId }] };
};

export const describeCreativeDirection = (direction?: CreativeDirection | null): string => {
  if (!direction) return 'Chưa chọn hướng nâng cao';
  return direction.selections
    .slice(0, MAX_ACTIVE_LENSES)
    .map((selection) => getCreativeLensOption(selection).label)
    .join(' · ');
};
