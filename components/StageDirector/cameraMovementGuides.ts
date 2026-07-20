export interface CameraMovementGuide {
  start: string;
  end: string;
}

export const CAMERA_MOVEMENT_GUIDES: Record<string, CameraMovementGuide> = {
  'lia máy ngang sang trái': {
    start: 'Bố cục: chủ thể ở bên phải khung hình, chừa khoảng trống bên trái cho hướng di chuyển.',
    end: 'Bố cục: chủ thể chuyển sang bên trái khung hình, thể hiện hành trình từ phải sang trái.'
  },
  'lia máy ngang sang phải': {
    start: 'Bố cục: chủ thể ở bên trái khung hình, chừa khoảng trống bên phải cho hướng di chuyển.',
    end: 'Bố cục: chủ thể chuyển sang bên phải khung hình, thể hiện hành trình từ trái sang phải.'
  },
  'quét máy sang trái': {
    start: 'Bố cục: khung hình tập trung vào phần bên phải của cảnh, chuẩn bị quét sang trái.',
    end: 'Bố cục: khung hình mở ra phần bên trái của cảnh, hoàn tất chuyển động quét máy.'
  },
  'quét máy sang phải': {
    start: 'Bố cục: khung hình tập trung vào phần bên trái của cảnh, chuẩn bị quét sang phải.',
    end: 'Bố cục: khung hình mở ra phần bên phải của cảnh, hoàn tất chuyển động quét máy.'
  },
  'thu gần': {
    start: 'Bố cục: toàn cảnh giới thiệu đầy đủ không gian, chủ thể nhỏ trong khung hình.',
    end: 'Bố cục: cận cảnh chặt vào chủ thể, lấp đầy khung hình bằng chi tiết và cảm xúc.'
  },
  'thu xa': {
    start: 'Bố cục: cận cảnh chủ thể, nhấn mạnh chi tiết và cảm xúc.',
    end: 'Bố cục: mở rộng thành toàn cảnh để lộ môi trường và ngữ cảnh xung quanh.'
  },
  'máy trượt': {
    start: 'Bố cục: khung hình ban đầu đặt chủ thể ở khoảng cách và phối cảnh xác định.',
    end: 'Bố cục: phối cảnh thay đổi khi chủ thể gần hoặc xa hơn, làm rõ chiều sâu không gian.'
  },
  'ngẩng máy lên': {
    start: 'Bố cục: máy quay hướng xuống hoặc ngang, ghi phần thấp của chủ thể.',
    end: 'Bố cục: máy quay ngẩng lên, bộc lộ chiều cao và không gian phía trên.'
  },
  'hạ máy xuống': {
    start: 'Bố cục: máy quay hướng lên hoặc ngang, nhấn mạnh phần trên.',
    end: 'Bố cục: máy quay hạ xuống, bộc lộ các yếu tố thấp và mặt đất.'
  },
  'máy đi lên': {
    start: 'Bố cục: vị trí máy thấp, chủ thể ở đáy khung hình hoặc sát mặt đất.',
    end: 'Bố cục: vị trí máy cao hơn, thể hiện chuyển động đi lên của chủ thể.'
  },
  'máy đi xuống': {
    start: 'Bố cục: vị trí máy cao, chủ thể nằm ở phần trên khung hình.',
    end: 'Bố cục: vị trí máy thấp hơn, thể hiện chuyển động đi xuống của chủ thể.'
  },
  'máy bám theo': {
    start: 'Bố cục: chủ thể trong khung hình, chừa không gian phía trước hoặc bên cạnh để bám theo.',
    end: 'Bố cục: máy bám theo chủ thể trong không gian và giữ quan hệ thị giác ổn định.'
  },
  'máy vòng quanh': {
    start: 'Bố cục: chủ thể ở giữa, máy quay tại góc đầu của quỹ đạo vòng.',
    end: 'Bố cục: chủ thể vẫn ở giữa, máy quay sang phía đối diện để lộ góc nhìn mới.'
  },
  'máy vòng 360 độ': {
    start: 'Bố cục: chủ thể ở giữa, máy quay bắt đầu quỹ đạo 360 độ.',
    end: 'Bố cục: chủ thể ở giữa, máy quay hoàn tất một vòng từ góc nhìn khác.'
  },
  'góc máy thấp': {
    start: 'Bố cục: góc máy thấp nhìn lên, nhấn mạnh chiều cao và sức mạnh.',
    end: 'Bố cục: duy trì góc thấp, chủ thể cao lớn trong phối cảnh kịch tính.'
  },
  'góc máy cao': {
    start: 'Bố cục: góc máy cao nhìn xuống, tạo góc nhìn bao quát.',
    end: 'Bố cục: duy trì góc cao, nhấn mạnh quy mô và quan hệ không gian.'
  },
  'góc nhìn từ trên cao': {
    start: 'Bố cục: nhìn thẳng từ trên xuống, thể hiện bố trí và hoa văn bên dưới.',
    end: 'Bố cục: tiếp tục góc nhìn trên cao, bộc lộ sự thay đổi trong sắp xếp không gian.'
  },
  'góc nhìn chủ quan': {
    start: 'Bố cục: góc nhìn thứ nhất từ mắt nhân vật.',
    end: 'Bố cục: duy trì góc nhìn chủ quan, thể hiện điều nhân vật thấy sau chuyển động.'
  },
  'góc qua vai': {
    start: 'Bố cục: khung hình có vai nhân vật ở tiền cảnh nhìn về chủ thể.',
    end: 'Bố cục: duy trì góc qua vai, có thể thay đổi điểm nét hoặc góc nhìn.'
  },
  'máy cầm tay': {
    start: 'Bố cục: khung hình cầm tay năng động với chuyển động tự nhiên.',
    end: 'Bố cục: tiếp tục thẩm mỹ cầm tay với sự thay đổi vị trí hữu cơ.'
  },
  'máy tĩnh': {
    start: 'Bố cục: máy quay cố định, khung hình ổn định xuyên suốt.',
    end: 'Bố cục: máy quay giữ nguyên vị trí, chỉ chủ thể chuyển động trong khung hình.'
  },
  'máy xoay': {
    start: 'Bố cục: chủ thể trong khung hình, máy quay bắt đầu xoay.',
    end: 'Bố cục: hướng của chủ thể thay đổi tương quan theo chuyển động xoay máy.'
  },
  'quay chậm': {
    start: 'Bố cục: ghi lại hành động ở đầu chuỗi chuyển động chậm.',
    end: 'Bố cục: hành động tiến triển, nhấn mạnh chi tiết chuyển động mềm mại.'
  },
  'bám theo song song': {
    start: 'Bố cục: máy quay bám song song bên cạnh chủ thể.',
    end: 'Bố cục: duy trì quan hệ song song khi chủ thể di chuyển trong không gian.'
  },
  'bám theo đường chéo': {
    start: 'Bố cục: máy quay bám chủ thể theo quỹ đạo đường chéo.',
    end: 'Bố cục: duy trì phối cảnh chéo, tạo cảm giác tiến triển không gian năng động.'
  },
  'góc máy nghiêng': {
    start: 'Bố cục: đường chân trời nghiêng tạo cảm giác bất an năng động.',
    end: 'Bố cục: duy trì hoặc điều chỉnh góc nghiêng, nhấn mạnh sự mất phương hướng.'
  },
  'trượt máy kết hợp thu phóng': {
    start: 'Bố cục: khung hình cân bằng trước hiệu ứng biến dạng phối cảnh.',
    end: 'Bố cục: phối cảnh biến đổi khi quan hệ giữa tiền cảnh và hậu cảnh thay đổi.'
  }
};

export const getCameraMovementCompositionGuide = (
  cameraMovement: string,
  frameType: 'start' | 'end'
): string => {
  const movement = cameraMovement.toLowerCase();
  
  for (const [key, value] of Object.entries(CAMERA_MOVEMENT_GUIDES)) {
    if (movement.includes(key) || key.includes(movement)) {
      return frameType === 'start' ? value.start : value.end;
    }
  }
  
  return frameType === 'start' 
    ? 'Bố cục: khung hình đầu phù hợp với chuyển động máy quay.'
    : 'Bố cục: khung hình cuối thể hiện kết quả của chuyển động máy quay.';
};
